package planner

import (
	"context"
	"fmt"
	"slices"
	"testing"
)

func TestQuantumResidueSuppliesCrystalProduction(t *testing.T) {
	for _, crystals := range []float64{10, 25, 40} {
		for _, reverse := range []bool{false, true} {
			t.Run(fmt.Sprintf("crystals=%g/reverse=%t", crystals, reverse), func(t *testing.T) {
				d := testDocument()
				d.Nodes = []Node{testNode("processors", "output", "Desc_TemporalProcessor_C", 5), testNode("crystals", "output", "Desc_DarkMatter_C", crystals)}
				if reverse {
					slices.Reverse(d.Nodes)
				}
				for _, item := range []string{"Desc_TimeCrystal_C", "Desc_ComputerSuper_C", "Desc_FicsiteMesh_C", "Desc_QuantumEnergy_C", "Desc_Diamond_C", "Desc_SAMIngot_C"} {
					d.Nodes = append(d.Nodes, testNode(item, "input", item, 0))
				}
				d, err := Expand(d, BundledCatalog())
				if err != nil {
					t.Fatal(err)
				}
				result := calculatePlan(t, d)
				nodes := nodeMap(d)
				byRecipe := map[string]NodeResult{}
				for _, r := range result.Nodes {
					byRecipe[nodes[r.NodeID].RecipeID] = r
				}
				near(t, byRecipe["Recipe_TemporalProcessor_C"].EquivalentMachines, 5.0/3)
				near(t, byRecipe["Recipe_DarkMatter_C"].EquivalentMachines, crystals/30)
				near(t, byRecipe["Recipe_DarkEnergy_C"].EquivalentMachines, max(0, crystals*5-125)/100)
				used := 0.0
				for _, e := range d.Connections {
					if nodes[e.Source].RecipeID == "Recipe_TemporalProcessor_C" && e.ItemID == "Desc_DarkEnergy_C" {
						for _, flow := range result.Connections {
							if flow.ConnectionID == e.ID {
								used += flow.Rate
							}
						}
					}
				}
				near(t, used, min(125, crystals*5))
				again, err := Expand(d, BundledCatalog())
				if err != nil || !EqualDocument(d, again) {
					t.Fatalf("repeated expansion changed the plan: %v", err)
				}
				pruneIdleGenerated(&d, result)
				calculatePlan(t, d)
			})
		}
	}
}

func byproductCatalog() Catalog {
	return Catalog{
		Version:  "test",
		Items:    []Item{{ID: "raw", Form: "solid", Resource: true}, {ID: "main", Form: "solid"}, {ID: "residue", Form: "solid"}},
		Machines: []Machine{{ID: "m", MinClock: 1, MaxClock: 250, PowerExponent: 1}},
		Recipes: []Recipe{
			{ID: "main", Duration: 60, MachineIDs: []string{"m"}, Ingredients: []Amount{{"raw", 1}}, Products: []Amount{{"main", 1}, {"residue", 2}}},
			{ID: "residue", Duration: 60, MachineIDs: []string{"m"}, Ingredients: []Amount{{"raw", 1}}, Products: []Amount{{"residue", 1}}},
		},
		Belts: []float64{60, 120, 270, 480, 780, 1200}, Pipes: []float64{300, 600},
	}
}

func TestByproductsRespectManualConnectionsAndSections(t *testing.T) {
	for _, mode := range []string{"same-section", "other-section", "parent-required-input", "manual"} {
		t.Run(mode, func(t *testing.T) {
			c := byproductCatalog()
			d := testDocument()
			d.Nodes = []Node{testNode("main", "output", "main", 1), testNode("residue", "output", "residue", 2)}
			switch mode {
			case "same-section", "other-section", "parent-required-input":
				d.Nodes = append(d.Nodes, testNode("group", "group", "", 0))
				d.Nodes[1].ParentID = "group"
				if mode == "same-section" {
					d.Nodes[0].ParentID = "group"
				}
				if mode == "parent-required-input" {
					n := testNode("required", "input", "residue", 0)
					n.ParentID = "group"
					d.Nodes = append(d.Nodes, n)
				}
			case "manual":
				d.Nodes = append(d.Nodes, testNode("external", "input", "residue", 0))
				d.Connections = []Connection{{ID: "manual", Source: "external", Target: "residue", ItemID: "residue"}}
			}
			d, err := Expand(d, c)
			if err != nil {
				t.Fatal(err)
			}
			nodes := nodeMap(d)
			count := 0
			for _, edge := range d.Connections {
				if nodes[edge.Source].RecipeID == "main" && edge.ItemID == "residue" {
					count++
					if mode == "parent-required-input" && edge.Target != "required" {
						t.Fatal("byproduct bypassed section's required input")
					}
				}
			}
			want := 0
			if mode == "same-section" || mode == "parent-required-input" {
				want = 1
			}
			if count != want {
				t.Fatalf("byproduct connections: got %d want %d", count, want)
			}
			results, err := Calculate(context.Background(), c, []Diagram{{ID: "d", Document: d}}, "")
			if err != nil || !results[0].Resolved {
				t.Fatalf("plan did not resolve: %v", err)
			}
		})
	}
}

func TestByproductsFeedTheirOwnProductionLoop(t *testing.T) {
	c := byproductCatalog()
	c.Recipes[0].Ingredients = append(c.Recipes[0].Ingredients, Amount{"residue", 3})
	d := testDocument()
	d.Nodes = []Node{testNode("main", "output", "main", 1)}
	d, err := Expand(d, c)
	if err != nil {
		t.Fatal(err)
	}
	results, err := Calculate(context.Background(), c, []Diagram{{ID: "d", Document: d}}, "")
	if err != nil || !results[0].Resolved {
		t.Fatalf("loop did not resolve: %v", err)
	}
	for _, result := range results[0].Nodes {
		if nodeMap(d)[result.NodeID].Kind == "production" {
			near(t, result.EquivalentMachines, 1)
		}
	}
}
