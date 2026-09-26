package planner

import (
	"context"
	"slices"
	"testing"
)

func TestTurboDiamondsExpandsPackagingAndFuel(t *testing.T) {
	c := BundledCatalog()
	for _, existing := range []bool{false, true} {
		d := testDocument()
		d.Settings.Recipes = []RecipeChoice{{ItemID: "Desc_Diamond_C", RecipeID: "Recipe_Alternate_Diamond_Turbo_C"}}
		d.Nodes = []Node{testNode("diamonds", "output", "Desc_Diamond_C", 30)}
		if existing {
			n := testNode("packaged", "input", "Desc_TurboFuel_C", 0)
			n.Generated = true
			d.Nodes = append(d.Nodes, n)
		}
		d, err := Expand(d, c)
		if err != nil {
			t.Fatal(err)
		}
		for _, recipe := range []string{"Recipe_PackagedTurboFuel_C", "Recipe_Alternate_Turbofuel_C", "Recipe_Alternate_EnrichedCoal_C"} {
			if !slices.ContainsFunc(d.Nodes, func(n Node) bool { return n.Kind == "production" && n.RecipeID == recipe }) {
				t.Fatalf("missing production for %s", recipe)
			}
		}
		if existing && nodeMap(d)["packaged"].Kind != "production" {
			t.Fatal("existing generated boundary did not become production")
		}
		x, _ := NewIndex(c)
		for _, n := range d.Nodes {
			if n.Kind == "input" && !x.Items[n.ItemID].Resource {
				t.Fatalf("manufactured material left as required input: %s", x.Items[n.ItemID].Name)
			}
		}
		results, err := Calculate(context.Background(), c, []Diagram{{ID: "d", Document: d}}, "")
		if err != nil || !results[0].Resolved {
			t.Fatalf("expanded chain did not resolve: %v", err)
		}
		for _, result := range results[0].Nodes {
			if nodeMap(d)[result.NodeID].RecipeID == "Recipe_PackagedTurboFuel_C" {
				near(t, result.Outputs[0].Rate, 20)
			}
		}
	}
}

func TestExplicitPackagedFuelInputIsPreserved(t *testing.T) {
	d := testDocument()
	d.Settings.Recipes = []RecipeChoice{{ItemID: "Desc_Diamond_C", RecipeID: "Recipe_Alternate_Diamond_Turbo_C"}}
	d.Nodes = []Node{testNode("diamonds", "output", "Desc_Diamond_C", 30), testNode("fuel", "input", "Desc_TurboFuel_C", 0)}
	d, err := Expand(d, BundledCatalog())
	if err != nil {
		t.Fatal(err)
	}
	if nodeMap(d)["fuel"].Kind != "input" || slices.ContainsFunc(d.Nodes, func(n Node) bool { return n.RecipeID == "Recipe_PackagedTurboFuel_C" }) {
		t.Fatal("explicit external input was expanded")
	}
}
