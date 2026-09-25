package planner

import (
	"context"
	"reflect"
	"slices"
	"testing"
)

func TestCatalogAbsenceAndReturn(t *testing.T) {
	original := BundledCatalog()
	incoming := BundledCatalog()
	incoming.Recipes = slices.DeleteFunc(incoming.Recipes, func(r Recipe) bool { return r.ID == "Recipe_IronPlate_C" })
	first := MergeCatalog(original, incoming)
	x, _ := NewIndex(first)
	if x.Recipes["Recipe_IronPlate_C"].Unavailable {
		t.Fatal("single absence removed recipe")
	}
	second := MergeCatalog(first, incoming)
	x, _ = NewIndex(second)
	if !x.Recipes["Recipe_IronPlate_C"].Unavailable || len(second.Recipes) != len(original.Recipes) {
		t.Fatal("missing recipe definition lost or not marked")
	}
	third := MergeCatalog(second, incoming)
	if !reflect.DeepEqual(second, third) {
		t.Fatal("identical snapshots are not stable")
	}
	restored := MergeCatalog(second, original)
	x, _ = NewIndex(restored)
	if x.Recipes["Recipe_IronPlate_C"].Unavailable {
		t.Fatal("return did not restore recipe")
	}
	locked := restored
	locked.Unlocks = []Unlock{{RecipeID: "Recipe_IronPlate_C", Unlocked: false}}
	if CatalogVersion(restored) != CatalogVersion(locked) {
		t.Fatal("unlocks affect calculation identity")
	}
}

func TestUnavailableNetworkLeavesIndependentProduction(t *testing.T) {
	c := BundledCatalog()
	d := testDocument()
	d.Nodes = []Node{testNode("plates", "output", "Desc_IronPlate_C", 60), testNode("wire", "output", "Desc_Wire_C", 60)}
	var err error
	d, err = Expand(d, c)
	if err != nil {
		t.Fatal(err)
	}
	for i := range c.Recipes {
		if c.Recipes[i].ID == "Recipe_IronPlate_C" {
			c.Recipes[i].Unavailable = true
		}
	}
	if err = Validate(d, c); err != nil {
		t.Fatal("unavailable plan cannot be edited", err)
	}
	results, err := Calculate(context.Background(), c, []Diagram{{ID: "d", Document: d}}, "")
	if err != nil {
		t.Fatal(err)
	}
	if results[0].Resolved {
		t.Fatal("unavailable network marked resolved")
	}
	found := false
	for _, n := range results[0].Nodes {
		if n.NodeID == "wire" {
			found = true
		}
	}
	if !found {
		t.Fatal("independent network disappeared")
	}
	if len(results[0].Diagnostics) == 0 {
		t.Fatal("missing unavailable diagnostics")
	}
}
