package planner

import (
	"context"
	"slices"
	"testing"
)

func TestDisabledScrapWaterDoesNotSupplyAlumina(t *testing.T) {
	d := testDocument()
	d.Settings.Recipes = []RecipeChoice{{ItemID: "Desc_AluminumScrap_C", RecipeID: "Recipe_Alternate_ElectroAluminumScrap_C"}}
	d.Nodes = []Node{testNode("scrap", "output", "Desc_AluminumScrap_C", 300), testNode("coke", "input", "Desc_PetroleumCoke_C", 0)}
	d, err := Expand(d, BundledCatalog())
	if err != nil {
		t.Fatal(err)
	}
	producer := ""
	for _, n := range d.Nodes {
		if n.Kind == "production" && n.ItemID == "Desc_AluminumScrap_C" {
			producer = n.ID
		}
	}
	for _, disabled := range []bool{false, true, false} {
		for i := range d.Nodes {
			if d.Nodes[i].ID == producer {
				d.Nodes[i].DisabledOutputs = nil
				if disabled {
					d.Nodes[i].DisabledOutputs = []string{"Desc_Water_C"}
				}
			}
		}
		d, err = Expand(d, BundledCatalog())
		if err != nil {
			t.Fatal(err)
		}
		result := calculatePlan(t, d)
		for _, n := range result.Nodes {
			if n.NodeID == producer {
				near(t, n.EquivalentMachines, 1)
				near(t, n.Inputs[0].Rate, 180)
				near(t, n.Inputs[1].Rate, 60)
				if slices.ContainsFunc(n.Outputs, func(f Flow) bool { return f.ItemID == "Desc_Water_C" }) == disabled {
					t.Fatal("disabled output participated in results")
				}
			}
			if nodeMap(d)[n.NodeID].Kind == "input" && nodeMap(d)[n.NodeID].ItemID == "Desc_Water_C" {
				want := 165.0
				if disabled {
					want = 270
				}
				near(t, n.Outputs[0].Rate, want)
			}
		}
		if disabled {
			for _, e := range d.Connections {
				if e.Source == producer && e.ItemID == "Desc_Water_C" {
					t.Fatal("disabled output was automatically connected")
				}
			}
			for _, diag := range result.Diagnostics {
				if diag.NodeID == producer && diag.ItemID == "Desc_Water_C" {
					t.Fatal("disabled output produced a surplus warning")
				}
			}
		}
		again, err := Expand(d, BundledCatalog())
		if err != nil || !EqualDocument(d, again) {
			t.Fatalf("repeated expansion changed output settings: %v", err)
		}
	}
}

func TestDisabledOutputIgnoresManualConnectionAndKeepsGeneratedSettings(t *testing.T) {
	c := byproductCatalog()
	d := testDocument()
	d.Nodes = []Node{testNode("out", "output", "main", 1), testNode("residue", "output", "residue", 2)}
	var err error
	d, err = Expand(d, c)
	if err != nil {
		t.Fatal(err)
	}
	producer := ""
	for i := range d.Nodes {
		if d.Nodes[i].Kind == "production" && d.Nodes[i].ItemID == "main" {
			producer = d.Nodes[i].ID
			d.Nodes[i].DisabledOutputs = []string{"main", "residue"}
		}
	}
	d.Connections = append(d.Connections, Connection{ID: "manual", Source: producer, Target: "residue", ItemID: "residue"})
	d, err = Expand(d, c)
	if err != nil {
		t.Fatal(err)
	}
	results, err := Calculate(context.Background(), c, []Diagram{{ID: "d", Document: d}}, "")
	if err != nil || !results[0].Resolved {
		t.Fatalf("calculation failed: %v", err)
	}
	for _, r := range results[0].Connections {
		if r.ConnectionID == "manual" && r.Rate != 0 {
			t.Fatal("disabled output supplied a manual connection")
		}
	}
	for _, r := range results[0].Nodes {
		if r.NodeID == producer {
			near(t, r.EquivalentMachines, 0)
		}
	}
	pruneIdleGenerated(&d, results[0])
	if len(nodeMap(d)[producer].DisabledOutputs) != 2 {
		t.Fatal("pruning lost the output settings")
	}
	if !slices.ContainsFunc(d.Connections, func(e Connection) bool { return e.ID == "manual" }) {
		t.Fatal("disabled manual connection was deleted")
	}
	for i := range d.Nodes {
		if d.Nodes[i].ID == producer {
			d.Nodes[i].DisabledOutputs = nil
		}
	}
	d, err = Expand(d, c)
	if err != nil {
		t.Fatal(err)
	}
	results, err = Calculate(context.Background(), c, []Diagram{{ID: "d", Document: d}}, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range results[0].Connections {
		if r.ConnectionID == "manual" {
			near(t, r.Rate, 2)
		}
	}
}

func TestDisabledOutputValidation(t *testing.T) {
	c := byproductCatalog()
	for _, kind := range []string{"production", "input"} {
		d := testDocument()
		n := testNode("n", kind, "main", 0)
		n.RecipeID, n.MachineID = "main", "m"
		n.DisabledOutputs = []string{"raw"}
		d.Nodes = []Node{n}
		if Validate(d, c) == nil {
			t.Fatal("invalid disabled output accepted")
		}
	}
}

func TestDisabledByproductCannotFeedSurplusRecipe(t *testing.T) {
	d, err := Expand(recycledPlan(0), BundledCatalog())
	if err != nil {
		t.Fatal(err)
	}
	for i := range d.Nodes {
		if d.Nodes[i].RecipeID == "Recipe_Alternate_HeavyOilResidue_C" {
			d.Nodes[i].DisabledOutputs = []string{"Desc_PolymerResin_C"}
		}
	}
	d, err = Expand(d, BundledCatalog())
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range calculatePlan(t, d).Nodes {
		if nodeMap(d)[result.NodeID].Surplus {
			near(t, result.EquivalentMachines, 0)
		}
	}
}
