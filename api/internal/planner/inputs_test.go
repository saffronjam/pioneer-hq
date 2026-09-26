package planner

import (
	"context"
	"slices"
	"testing"
)

func cablePlan(t *testing.T) Document {
	t.Helper()
	d := testDocument()
	d.Nodes = []Node{testNode("cable", "output", "Desc_Cable_C", 60)}
	d, err := Expand(d, BundledCatalog())
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestStandardPlasticExpandsToOilAndExportsOilRequirement(t *testing.T) {
	c := BundledCatalog()
	d := testDocument()
	d.Nodes = []Node{testNode("plastic-out", "output", "Desc_Plastic_C", 84), testNode("plastic-auto", "input", "Desc_Plastic_C", 0)}
	d.Nodes[1].Generated = true
	d.Connections = []Connection{{ID: "plastic-edge", Source: "plastic-auto", Target: "plastic-out", ItemID: "Desc_Plastic_C", Generated: true}}
	expanded, err := Expand(d, c)
	if err != nil {
		t.Fatal(err)
	}
	nodes := nodeMap(expanded)
	if nodes["plastic-auto"].Kind != "production" || nodes["plastic-auto"].RecipeID != "Recipe_Plastic_C" {
		t.Fatal("standard Plastic recipe not selected", nodes["plastic-auto"])
	}
	var oil Node
	for _, n := range expanded.Nodes {
		if n.Kind == "input" {
			if n.ItemID != "Desc_LiquidOil_C" {
				t.Fatal("unexpected required input", n)
			}
			oil = n
		}
	}
	if oil.ID == "" {
		t.Fatal("no oil requirement")
	}
	parent := testDocument()
	parent.Nodes = []Node{testNode("oil-supply", "supply", oil.ItemID, 126), {ID: "factory", Kind: "link", LinkedDiagramID: "child", Status: "planned"}}
	parent.Connections = []Connection{{ID: "oil-feed", Source: "oil-supply", Target: "factory", TargetPort: oil.ID, ItemID: oil.ItemID}}
	rs := solvePlan(t, Diagram{ID: "child", SessionID: "s", Document: expanded}, Diagram{ID: "parent", SessionID: "s", Document: parent})
	near(t, rs[1].Connections[0].Rate, 126)
	for _, diagnostic := range rs[0].Diagnostics {
		if diagnostic.Code == "input_shortage" {
			t.Fatal("supplied oil must satisfy child requirements", diagnostic)
		}
	}
	d.Settings.Recipes = []RecipeChoice{{ItemID: "Desc_Plastic_C", RecipeID: "Recipe_ResidualPlastic_C"}}
	expanded, err = Expand(d, c)
	if err != nil || nodeMap(expanded)["plastic-auto"].RecipeID != "Recipe_ResidualPlastic_C" {
		t.Fatal("explicit recipe preference not retained", err)
	}
	d = testDocument()
	d.Nodes = []Node{testNode("target", "output", "Desc_Plastic_C", 84), testNode("manual", "input", "Desc_Plastic_C", 0)}
	expanded, err = Expand(d, c)
	if err != nil || len(expanded.Nodes) != 2 || nodeMap(expanded)["manual"].Kind != "input" {
		t.Fatal("explicit required Plastic input not retained", err)
	}
}

func solvePlan(t *testing.T, ds ...Diagram) []Calculation {
	t.Helper()
	rs, err := Calculate(context.Background(), BundledCatalog(), ds, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rs {
		if !r.Resolved {
			t.Fatalf("unresolved: %+v", r.Diagnostics)
		}
	}
	return rs
}

func TestRequiredWireReplacesGeneratedBranch(t *testing.T) {
	d := cablePlan(t)
	required := testNode("wire-input", "input", "Desc_Wire_C", 0)
	required.InputRateMode = "calculated"
	d.Nodes = append(d.Nodes, required)
	var err error
	d, err = Expand(d, BundledCatalog())
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Nodes) != 3 || len(d.Connections) != 2 {
		t.Fatalf("obsolete branch retained: %+v", d.Nodes)
	}
	r := solvePlan(t, Diagram{ID: "child", Document: d})[0]
	for _, n := range r.Nodes {
		if n.NodeID == required.ID {
			near(t, n.Outputs[0].Rate, 120)
		}
	}
	same, err := Expand(d, BundledCatalog())
	if err != nil || !EqualDocument(d, same) {
		t.Fatal("expansion changed an unchanged graph", err)
	}
	d.Nodes = slices.DeleteFunc(d.Nodes, func(n Node) bool { return n.ID == required.ID })
	d.Connections = slices.DeleteFunc(d.Connections, func(e Connection) bool { return e.Source == required.ID })
	d, err = Expand(d, BundledCatalog())
	if err != nil || len(d.Nodes) != 5 {
		t.Fatal("removing boundary did not restore production", err, len(d.Nodes))
	}
}

func TestFixedRequiredInputParentContract(t *testing.T) {
	for _, rate := range []float64{100, 300} {
		t.Run(numberForTest(rate), func(t *testing.T) {
			d := cablePlan(t)
			n := testNode("wire-input", "input", "Desc_Wire_C", rate)
			n.InputRateMode = "fixed"
			d.Nodes = append(d.Nodes, n)
			d, err := Expand(d, BundledCatalog())
			if err != nil {
				t.Fatal(err)
			}
			parent := testDocument()
			parent.Nodes = []Node{testNode("supply", "supply", "Desc_Wire_C", rate), {ID: "link", Kind: "link", LinkedDiagramID: "child", Status: "planned"}}
			parent.Connections = []Connection{{ID: "feed", Source: "supply", Target: "link", TargetPort: n.ID, ItemID: n.ItemID}}
			rs := solvePlan(t, Diagram{ID: "child", SessionID: "s", Document: d}, Diagram{ID: "parent", SessionID: "s", Document: parent})
			near(t, rs[1].Connections[0].Rate, rate)
			found := false
			for _, diag := range rs[0].Diagnostics {
				if rate == 300 && diag.Code == "surplus" {
					near(t, diag.Rate, 180)
					found = true
				}
				if rate == 100 && diag.Code == "required_input_shortage" {
					near(t, diag.Rate, 20)
					found = true
				}
			}
			if !found {
				t.Fatalf("missing fixed input diagnostic: %+v", rs[0].Diagnostics)
			}
		})
	}
}
func numberForTest(v float64) string {
	if v == 100 {
		return "shortage"
	}
	return "surplus"
}

func TestPartialWireSupplyAndIndependentScopes(t *testing.T) {
	d := cablePlan(t)
	d.Nodes = append(d.Nodes, testNode("wire-supply", "supply", "Desc_Wire_C", 60))
	d, err := Expand(d, BundledCatalog())
	if err != nil {
		t.Fatal(err)
	}
	r := solvePlan(t, Diagram{ID: "d", Document: d})[0]
	for _, n := range r.Nodes {
		if n.NodeID == "wire-supply" {
			near(t, n.Outputs[0].Rate, 60)
		}
		if nodeMap(d)[n.NodeID].RecipeID == "Recipe_Wire_C" {
			near(t, n.EquivalentMachines, 2)
		}
	}
	other := testNode("other", "input", "Desc_Wire_C", 0)
	other.ParentID = "section"
	d.Nodes = append(d.Nodes, Node{ID: "section", Kind: "group", Status: "planned"}, other)
	d, err = Expand(d, BundledCatalog())
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range d.Connections {
		if e.Source == other.ID {
			t.Fatal("input leaked across sections")
		}
	}
}

func TestReconciliationPreservesManualAndSharedBranches(t *testing.T) {
	for _, protected := range []string{"manual", "shared"} {
		t.Run(protected, func(t *testing.T) {
			d := cablePlan(t)
			var wire string
			for _, n := range d.Nodes {
				if n.RecipeID == "Recipe_Wire_C" {
					wire = n.ID
				}
			}
			if protected == "manual" {
				for i, e := range d.Connections {
					if e.Source == wire {
						d.Connections[i].Generated = false
					}
				}
			}
			if protected == "shared" {
				target := testNode("wire-output", "output", "Desc_Wire_C", 30)
				d.Nodes = append(d.Nodes, target)
				d.Connections = append(d.Connections, Connection{ID: "manual", Source: wire, Target: target.ID, ItemID: target.ItemID})
			}
			d.Nodes = append(d.Nodes, testNode("required", "input", "Desc_Wire_C", 0))
			d, err := Expand(d, BundledCatalog())
			if err != nil {
				t.Fatal(err)
			}
			if nodeMap(d)[wire].ID == "" {
				t.Fatal("protected production deleted")
			}
			solvePlan(t, Diagram{ID: "d", Document: d})
		})
	}
}

func TestCalculationKeysIgnorePresentationAndTrackLinkedDemand(t *testing.T) {
	c := BundledCatalog()
	d := cablePlan(t)
	ds := []Diagram{{ID: "child", Document: d}, {ID: "parent", Document: testDocument()}}
	ds[1].Document.Nodes = []Node{{ID: "link", Kind: "link", LinkedDiagramID: "child", Status: "planned"}}
	stampCalculationKeys(c, ds)
	original := ds[0].CalculationKey
	if original != ds[1].CalculationKey {
		t.Fatal("linked components need shared keys")
	}
	ds[0].Document.Nodes[0].X += 10
	ds[0].Document.Nodes[0].Status = "built"
	ds[0].Document.Name = "Renamed"
	ds[0].Document.Viewport.X = 30
	ds[0].Document.Nodes = slices.Clone(ds[0].Document.Nodes)
	slices.Reverse(ds[0].Document.Nodes)
	stampCalculationKeys(c, ds)
	if ds[0].CalculationKey != original {
		t.Fatal("presentation invalidated calculation")
	}
	for i, n := range ds[0].Document.Nodes {
		if n.Kind == "output" {
			ds[0].Document.Nodes[i].Rate = 90
		}
	}
	stampCalculationKeys(c, ds)
	if ds[0].CalculationKey == original || ds[1].CalculationKey == original {
		t.Fatal("material change did not invalidate dependencies")
	}
}

func TestDeletingOutputPrunesGeneratedNodesRegardlessOfStatus(t *testing.T) {
	for _, status := range []string{"planned", "building", "built"} {
		t.Run(status, func(t *testing.T) {
			d := cablePlan(t)
			for i := range d.Nodes {
				if d.Nodes[i].Kind == "production" {
					d.Nodes[i].Status = status
				}
			}
			d.Nodes = slices.DeleteFunc(d.Nodes, func(n Node) bool { return n.Kind == "output" })
			d.Connections = slices.DeleteFunc(d.Connections, func(e Connection) bool { return e.Target == "cable" })
			d.Nodes = append(d.Nodes, testNode("section", "group", "", 0), testNode("supply", "supply", "Desc_Wire_C", 60))
			var err error
			d, err = Expand(d, BundledCatalog())
			if err != nil {
				t.Fatal(err)
			}
			if len(d.Nodes) != 2 || len(d.Connections) != 0 || nodeMap(d)["section"].ID == "" || nodeMap(d)["supply"].ID == "" {
				t.Fatalf("orphaned generated nodes remained or manual nodes were deleted: %+v", d)
			}
		})
	}
}

func TestDeletingOutputPreservesSharedProductionAndStatus(t *testing.T) {
	for _, status := range []string{"building", "built"} {
		t.Run(status, func(t *testing.T) {
			d := cablePlan(t)
			var wireID string
			for i := range d.Nodes {
				if d.Nodes[i].Kind == "production" {
					d.Nodes[i].Status = status
				}
				if d.Nodes[i].RecipeID == "Recipe_Wire_C" {
					wireID = d.Nodes[i].ID
				}
			}
			d.Nodes = append(d.Nodes, testNode("wire-output", "output", "Desc_Wire_C", 30))
			var err error
			d, err = Expand(d, BundledCatalog())
			if err != nil {
				t.Fatal(err)
			}
			d.Nodes = slices.DeleteFunc(d.Nodes, func(n Node) bool { return n.ID == "cable" })
			d.Connections = slices.DeleteFunc(d.Connections, func(e Connection) bool { return e.Target == "cable" })
			d, err = Expand(d, BundledCatalog())
			if err != nil {
				t.Fatal(err)
			}
			r := solvePlan(t, Diagram{ID: "d", Document: d})[0]
			pruneIdleGenerated(&d, r)
			if nodeMap(d)[wireID].Status != status {
				t.Fatal("shared production lost its identity or status")
			}
			for _, n := range d.Nodes {
				if n.RecipeID == "Recipe_Cable_C" {
					t.Fatal("unused Cable production survived output deletion")
				}
			}
			if len(d.Nodes) != 4 || len(d.Connections) != 3 {
				t.Fatalf("unexpected shared branch: %+v", d)
			}
		})
	}
}

func TestFullSupplyPrunesIdleProductionRegardlessOfStatus(t *testing.T) {
	for _, status := range []string{"building", "built"} {
		t.Run(status, func(t *testing.T) {
			d := cablePlan(t)
			for i := range d.Nodes {
				if d.Nodes[i].Kind == "production" {
					d.Nodes[i].Status = status
				}
			}
			d.Nodes = append(d.Nodes, testNode("wire-supply", "supply", "Desc_Wire_C", 120))
			d, err := Expand(d, BundledCatalog())
			if err != nil {
				t.Fatal(err)
			}
			pruneIdleGenerated(&d, solvePlan(t, Diagram{ID: "d", Document: d})[0])
			if len(d.Nodes) != 3 || len(d.Connections) != 2 {
				t.Fatalf("idle upstream production was retained: %+v", d)
			}
		})
	}
}

func TestExternalRequiredInputsAreExpected(t *testing.T) {
	for _, mode := range []string{"calculated", "fixed"} {
		t.Run(mode, func(t *testing.T) {
			d := testDocument()
			input := testNode("input", "input", "Desc_Wire_C", 60)
			input.InputRateMode = mode
			d.Nodes = []Node{input, testNode("out", "output", "Desc_Cable_C", 30)}
			d = expandExport(t, d)
			r := solvePlan(t, Diagram{ID: "d", Document: d})[0]
			near(t, outputResult(t, r, input.ID).Outputs[0].Rate, 60)
			if len(r.Diagnostics) != 0 {
				t.Fatal("declared external input generated a warning", r.Diagnostics)
			}
			if mode == "fixed" {
				for i := range d.Nodes {
					if d.Nodes[i].ID == input.ID {
						d.Nodes[i].Rate = 40
					}
				}
				r = solvePlan(t, Diagram{ID: "d", Document: d})[0]
				if len(r.Diagnostics) != 1 || r.Diagnostics[0].Code != "required_input_shortage" {
					t.Fatal("actual fixed-rate shortage was hidden", r.Diagnostics)
				}
				near(t, r.Diagnostics[0].Rate, 20)
			}
		})
	}
}
