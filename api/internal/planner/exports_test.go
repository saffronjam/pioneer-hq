package planner

import (
	"slices"
	"testing"
)

func sectionExport(t *testing.T, mode string, rate float64) Document {
	t.Helper()
	d := testDocument()
	out := testNode("wire-export", "output", "Desc_Wire_C", rate)
	out.ParentID, out.Exposed, out.OutputRateMode = "section", true, mode
	d.Nodes = []Node{testNode("section", "group", "", 0), out, testNode("cable-out", "output", "Desc_Cable_C", 30)}
	return expandExport(t, d)
}

func expandExport(t *testing.T, d Document, diagrams ...Diagram) Document {
	t.Helper()
	expanded, err := Expand(d, BundledCatalog(), diagrams...)
	if err != nil {
		t.Fatal(err)
	}
	return expanded
}

func outputResult(t *testing.T, c Calculation, id string) NodeResult {
	t.Helper()
	for _, n := range c.Nodes {
		if n.NodeID == id {
			return n
		}
	}
	t.Fatalf("missing output %s", id)
	return NodeResult{}
}

func TestFixedSectionExportAllocatesProductionOnce(t *testing.T) {
	d := sectionExport(t, "fixed", 120)
	d.Nodes = append(d.Nodes, testNode("wire-out", "output", "Desc_Wire_C", 30))
	d = expandExport(t, d)
	r := solvePlan(t, Diagram{ID: "d", Document: d})[0]
	out := outputResult(t, r, "wire-export")
	near(t, out.Outputs[0].Rate, 120)
	near(t, out.ExportRate, 90)
	near(t, out.SurplusRate, 30)
	pruneIdleGenerated(&d, r)
	for _, n := range d.Nodes {
		if n.Kind == "production" && n.ItemID == "Desc_Wire_C" && n.ParentID != "section" {
			t.Fatal("parent generated redundant Wire production", n)
		}
	}
}

func TestDemandSectionExportScalesAndKeepsIdleProduction(t *testing.T) {
	d := sectionExport(t, "demand", 999)
	for _, demand := range []float64{30, 60, 0, 45} {
		for i := range d.Nodes {
			if d.Nodes[i].ID == "cable-out" {
				d.Nodes[i].Rate = demand
			}
		}
		d = expandExport(t, d)
		r := solvePlan(t, Diagram{ID: "d", Document: d})[0]
		out := outputResult(t, r, "wire-export")
		near(t, out.Outputs[0].Rate, demand*2)
		near(t, out.ExportRate, demand*2)
		near(t, out.SurplusRate, 0)
		pruneIdleGenerated(&d, r)
		if !slices.ContainsFunc(d.Nodes, func(n Node) bool {
			return n.ParentID == "section" && n.Kind == "production" && n.ItemID == "Desc_Wire_C"
		}) {
			t.Fatal("demand factory lost its production graph while idle")
		}
	}
}

func TestPrivateOutputIsNotUsedByParent(t *testing.T) {
	d := sectionExport(t, "fixed", 120)
	for i := range d.Nodes {
		if d.Nodes[i].ID == "wire-export" {
			d.Nodes[i].Exposed = false
		}
	}
	d = expandExport(t, d)
	for _, e := range d.Connections {
		if e.Source == "wire-export" {
			t.Fatal("private output exported", e)
		}
	}
	r := solvePlan(t, Diagram{ID: "d", Document: d})[0]
	near(t, outputResult(t, r, "wire-export").ExportRate, 0)
	if !slices.ContainsFunc(d.Nodes, func(n Node) bool { return n.ParentID == "" && n.Kind == "production" && n.ItemID == "Desc_Wire_C" }) {
		t.Fatal("parent did not restore local production")
	}
}

func TestNestedDemandExportsRelayWithoutDoubleCounting(t *testing.T) {
	d := sectionExport(t, "demand", 0)
	outer := testNode("outer", "group", "", 0)
	for i := range d.Nodes {
		if d.Nodes[i].ID == "section" {
			d.Nodes[i].ParentID = outer.ID
		}
	}
	relay := testNode("relay", "output", "Desc_Wire_C", 0)
	relay.ParentID, relay.Exposed, relay.OutputRateMode = outer.ID, true, "demand"
	d.Nodes = append(d.Nodes, outer, relay)
	d = expandExport(t, d)
	r := solvePlan(t, Diagram{ID: "d", Document: d})[0]
	for _, id := range []string{"wire-export", "relay"} {
		out := outputResult(t, r, id)
		near(t, out.Outputs[0].Rate, 60)
		near(t, out.ExportRate, 60)
	}
	for _, e := range d.Connections {
		if e.Source == "wire-export" && e.Target != "relay" {
			t.Fatal("nested export escaped its parent scope", e)
		}
	}
}

func TestLinkedDemandExportSharesOneFactoryAcrossParents(t *testing.T) {
	child := testDocument()
	out := testNode("export", "output", "Desc_Wire_C", 0)
	out.Exposed, out.OutputRateMode = true, "demand"
	child.Nodes = []Node{out}
	child = expandExport(t, child)
	idle := solvePlan(t, Diagram{ID: "child", SessionID: "s", Document: child})[0]
	pruneIdleGenerated(&child, idle)
	diagrams := []Diagram{{ID: "child", SessionID: "s", Document: child}}
	for _, id := range []string{"a", "b"} {
		parent := testDocument()
		link := testNode("link", "link", "", 0)
		link.LinkedDiagramID = "child"
		parent.Nodes = []Node{link, testNode("target", "output", "Desc_Cable_C", 30)}
		parent = expandExport(t, parent, diagrams...)
		diagrams = append(diagrams, Diagram{ID: id, SessionID: "s", Document: parent})
	}
	rs := solvePlan(t, diagrams...)
	exported := outputResult(t, rs[0], "export")
	near(t, exported.Outputs[0].Rate, 120)
	near(t, exported.ExportRate, 120)
	for i := 1; i < len(diagrams); i++ {
		for _, n := range diagrams[i].Document.Nodes {
			if n.Kind == "production" && n.ItemID == "Desc_Wire_C" {
				t.Fatal("duplicated shared factory")
			}
		}
	}
}

func TestManualFixedExportReportsOverAllocation(t *testing.T) {
	d := sectionExport(t, "fixed", 40)
	var consumer string
	for _, n := range d.Nodes {
		if n.ItemID == "Desc_Cable_C" && n.Kind == "production" {
			consumer = n.ID
		}
	}
	d.Connections = slices.DeleteFunc(d.Connections, func(e Connection) bool { return e.Target == consumer && e.ItemID == "Desc_Wire_C" })
	d.Connections = append(d.Connections, Connection{ID: "explicit", Source: "wire-export", Target: consumer, ItemID: "Desc_Wire_C"})
	d = expandExport(t, d)
	r := solvePlan(t, Diagram{ID: "d", Document: d})[0]
	near(t, outputResult(t, r, "wire-export").Outputs[0].Rate, 40)
	found := false
	for _, diagnostic := range r.Diagnostics {
		if diagnostic.Code == "overallocated" {
			near(t, diagnostic.Rate, 20)
			found = true
		}
	}
	if !found {
		t.Fatal("missing export shortage", r.Diagnostics)
	}
}

func TestChildRequirementsResolveInClosestParent(t *testing.T) {
	for _, tc := range []struct {
		name            string
		manualScopes    []string
		productionScope string
		rootItem        string
	}{
		{"closest parent", nil, "outer", "Desc_OreIron_C"},
		{"explicit parent requirement", []string{"outer"}, "", "Desc_OreIron_C"},
		{"explicit root requirement", []string{"outer", ""}, "none", "Desc_IronIngot_C"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := testDocument()
			d.Nodes = []Node{testNode("outer", "group", "", 0)}
			for _, scope := range tc.manualScopes {
				input := testNode("manual-"+scope, "input", "Desc_IronIngot_C", 0)
				input.ParentID = scope
				d.Nodes = append(d.Nodes, input)
			}
			for _, id := range []string{"a", "b"} {
				group := testNode(id, "group", "", 0)
				group.ParentID = "outer"
				input := testNode(id+"-input", "input", "Desc_IronIngot_C", 0)
				input.ParentID = id
				output := testNode(id+"-out", "output", "Desc_IronRod_C", 15)
				output.ParentID = id
				d.Nodes = append(d.Nodes, group, input, output)
			}
			ids := map[string]string{}
			for range 3 {
				d = expandExport(t, d)
				r := solvePlan(t, Diagram{ID: "d", Document: d})[0]
				var rootInput string
				producers := 0
				for _, n := range d.Nodes {
					key := n.ParentID + "/" + n.Kind + "/" + n.ItemID
					if n.Kind == "group" {
						key += "/" + n.ID
					}
					if old := ids[key]; old != "" && old != n.ID {
						t.Fatal("calculation replaced a node", n)
					}
					ids[key] = n.ID
					if n.Kind == "production" && n.ItemID == "Desc_IronIngot_C" {
						producers++
						if n.ParentID != tc.productionScope {
							t.Fatal("production escaped the closest resolving parent", n)
						}
						near(t, outputResult(t, r, n.ID).Outputs[0].Rate, 30)
					}
					if n.Kind == "input" && n.ParentID == "" {
						if rootInput != "" || n.ItemID != tc.rootItem {
							t.Fatal("unexpected root requirement", n)
						}
						rootInput = n.ID
						near(t, outputResult(t, r, n.ID).Outputs[0].Rate, 30)
					}
				}
				wantProducers := 1
				if tc.productionScope == "none" {
					wantProducers = 0
				}
				if rootInput == "" || producers != wantProducers {
					t.Fatal("missing or duplicated supply chain", d.Nodes)
				}
				for _, diagnostic := range r.Diagnostics {
					if diagnostic.Code == "input_shortage" {
						t.Fatal("declared external requirement produced a warning", diagnostic)
					}
				}
			}
		})
	}
}

func TestParentSupplyFeedsNestedRequirementAndRetainsConnections(t *testing.T) {
	d := testDocument()
	group := testNode("section", "group", "", 0)
	input := testNode("input", "input", "Desc_IronIngot_C", 60)
	input.ParentID, input.InputRateMode = group.ID, "fixed"
	output := testNode("out", "output", "Desc_IronRod_C", 15)
	output.ParentID = group.ID
	d.Nodes = []Node{group, input, output, testNode("supply", "supply", "Desc_IronIngot_C", 60)}
	d = expandExport(t, d)
	r := solvePlan(t, Diagram{ID: "d", Document: d})[0]
	near(t, outputResult(t, r, "supply").Outputs[0].Rate, 60)
	for _, diagnostic := range r.Diagnostics {
		if diagnostic.Code == "input_shortage" {
			t.Fatal("supplied requirement reported a shortage", diagnostic)
		}
	}
	pruneIdleGenerated(&d, r)
	old := slices.Clone(d.Connections)
	d = expandExport(t, d)
	for _, e := range old {
		if !slices.ContainsFunc(d.Connections, func(n Connection) bool { return n.ID == e.ID }) {
			t.Fatal("calculation replaced an established connection", e)
		}
	}
}

func TestGeneratedParentRequirementExpandsOnRecalculation(t *testing.T) {
	d := testDocument()
	group := testNode("section", "group", "", 0)
	input := testNode("input", "input", "Desc_IronIngot_C", 0)
	input.ParentID = group.ID
	output := testNode("out", "output", "Desc_IronRod_C", 15)
	output.ParentID = group.ID
	propagated := testNode("propagated", "input", input.ItemID, 0)
	propagated.Generated = true
	d.Nodes = []Node{group, input, output, propagated}
	d.Connections = []Connection{{ID: "import", Source: propagated.ID, Target: input.ID, ItemID: input.ItemID, Generated: true}}
	d = expandExport(t, d)
	n := nodeMap(d)[propagated.ID]
	if n.Kind != "production" || n.ParentID != "" || n.RecipeID != "Recipe_IngotIron_C" {
		t.Fatal("parent did not resolve ingots locally", n)
	}
	r := solvePlan(t, Diagram{ID: "d", Document: d})[0]
	near(t, outputResult(t, r, propagated.ID).Outputs[0].Rate, 15)
	for _, n := range d.Nodes {
		if n.Kind == "input" && n.ParentID == "" {
			if n.ItemID != "Desc_OreIron_C" {
				t.Fatal("main diagram requires manufactured material", n)
			}
			near(t, outputResult(t, r, n.ID).Outputs[0].Rate, 15)
		}
	}
	if !slices.ContainsFunc(d.Connections, func(e Connection) bool { return e.ID == "import" }) {
		t.Fatal("existing section import connection was replaced")
	}
}

func TestBoundaryItemChangesRebuildSupplyChain(t *testing.T) {
	d := testDocument()
	d.Nodes = []Node{testNode("out", "output", "Desc_Wire_C", 30), testNode("input", "input", "Desc_Wire_C", 0)}
	d = expandExport(t, d)
	change := func(id, item string) {
		for i := range d.Nodes {
			if d.Nodes[i].ID == id {
				d.Nodes[i].ItemID = item
				d.Nodes[i].Generated = false
			}
		}
		d.Connections = slices.DeleteFunc(d.Connections, func(e Connection) bool { return e.Source == id || e.Target == id })
		d = expandExport(t, d)
	}
	change("out", "Desc_Cable_C")
	r := solvePlan(t, Diagram{ID: "d", Document: d})[0]
	near(t, outputResult(t, r, "input").Outputs[0].Rate, 60)
	change("input", "Desc_CopperIngot_C")
	r = solvePlan(t, Diagram{ID: "d", Document: d})[0]
	near(t, outputResult(t, r, "input").Outputs[0].Rate, 30)
	if nodeMap(d)["input"].Kind != "input" {
		t.Fatal("authored required input became production")
	}
	wire, cable := false, false
	for _, n := range d.Nodes {
		if n.Kind == "production" {
			wire = wire || n.ItemID == "Desc_Wire_C"
			cable = cable || n.ItemID == "Desc_Cable_C"
			if n.ItemID == "Desc_CopperIngot_C" {
				t.Fatal("required input was ignored")
			}
		}
	}
	if !wire || !cable {
		t.Fatal("changed boundaries did not rebuild the production chain")
	}
}

func TestFixedLinkedFactoryConnectsInputsAndCapsOutput(t *testing.T) {
	child := testDocument()
	out := testNode("wire-export", "output", "Desc_Wire_C", 40)
	out.Exposed = true
	child.Nodes = []Node{out}
	child = expandExport(t, child)
	imported := Diagram{ID: "child", SessionID: "s", Document: child}
	parent := testDocument()
	link := testNode("link", "link", "", 0)
	link.LinkedDiagramID = imported.ID
	parent.Nodes = []Node{link, testNode("cable", "output", "Desc_Cable_C", 30)}
	parent = expandExport(t, parent, imported)
	results := solvePlan(t, imported, Diagram{ID: "parent", SessionID: "s", Document: parent})
	linked := outputResult(t, results[1], "link")
	if len(linked.Inputs) == 0 {
		t.Fatal("linked requirements did not propagate")
	}
	near(t, linked.Outputs[0].Rate, 40)
	near(t, outputResult(t, results[0], out.ID).ExportRate, 40)
	local := 0.0
	for _, n := range results[1].Nodes {
		node := nodeMap(parent)[n.NodeID]
		if node.Kind == "production" && node.ItemID == "Desc_Wire_C" {
			local += n.Outputs[0].Rate
		}
	}
	near(t, local, 20)
}
