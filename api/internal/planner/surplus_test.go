package planner

import (
	"context"
	"slices"
	"testing"
)

func recycledPlan(fuel float64) Document {
	d := testDocument()
	d.Settings.Recipes = []RecipeChoice{
		{ItemID: "Desc_Plastic_C", RecipeID: "Recipe_Alternate_Plastic_1_C"},
		{ItemID: "Desc_Rubber_C", RecipeID: "Recipe_Alternate_RecycledRubber_C", SurplusRecipeID: "Recipe_ResidualRubber_C"},
		{ItemID: "Desc_LiquidFuel_C", RecipeID: "Recipe_Alternate_DilutedFuel_C"},
		{ItemID: "Desc_HeavyOilResidue_C", RecipeID: "Recipe_Alternate_HeavyOilResidue_C"},
	}
	d.Nodes = []Node{testNode("plastic", "output", "Desc_Plastic_C", 300), testNode("rubber", "output", "Desc_Rubber_C", 300)}
	if fuel > 0 {
		d.Nodes = append(d.Nodes, testNode("fuel", "output", "Desc_LiquidFuel_C", fuel))
	}
	return d
}

func calculatePlan(t *testing.T, d Document) Calculation {
	t.Helper()
	results, err := Calculate(context.Background(), BundledCatalog(), []Diagram{{ID: "d", SessionID: "s", Document: d}}, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, diagnostic := range results[0].Diagnostics {
		if diagnostic.Code != "surplus" {
			t.Fatalf("unexpected diagnostic: %+v", diagnostic)
		}
	}
	return results[0]
}

func TestSurplusRecycledLoop(t *testing.T) {
	for _, fuel := range []float64{0, 300} {
		d, err := Expand(recycledPlan(fuel), BundledCatalog())
		if err != nil {
			t.Fatal(err)
		}
		result := calculatePlan(t, d)
		byRecipe := map[string]NodeResult{}
		for _, r := range result.Nodes {
			byRecipe[nodeMap(d)[r.NodeID].RecipeID] = r
		}
		oil := 200 + fuel/3
		residualRubber := oil / 3
		near(t, byRecipe["Recipe_Alternate_HeavyOilResidue_C"].Inputs[0].Rate, oil)
		near(t, byRecipe["Recipe_ResidualRubber_C"].Outputs[0].Rate, residualRubber)
		near(t, byRecipe["Recipe_Alternate_Plastic_1_C"].EquivalentMachines, 10-residualRubber/90)
		near(t, byRecipe["Recipe_Alternate_RecycledRubber_C"].EquivalentMachines, 10-residualRubber/45)
		if fuel == 300 {
			near(t, byRecipe["Recipe_ResidualRubber_C"].EquivalentMachines, 5)
			near(t, byRecipe["Recipe_Alternate_DilutedFuel_C"].EquivalentMachines, 8)
		}
		again, err := Expand(d, BundledCatalog())
		if err != nil {
			t.Fatal(err)
		}
		if !EqualDocument(d, again) {
			t.Fatal("repeated expansion changed nodes or connections")
		}
		for i := range d.Settings.Recipes {
			d.Settings.Recipes[i].SurplusRecipeID = ""
		}
		d, err = Expand(d, BundledCatalog())
		if err != nil {
			t.Fatal(err)
		}
		for _, n := range d.Nodes {
			if n.Surplus {
				t.Fatal("removed surplus preference left its node")
			}
		}
		calculatePlan(t, d)
	}
}

func TestSurplusDoesNotCreateFeedstock(t *testing.T) {
	d := recycledPlan(0)
	d.Settings.Recipes = slices.DeleteFunc(d.Settings.Recipes, func(r RecipeChoice) bool {
		return r.ItemID == "Desc_LiquidFuel_C" || r.ItemID == "Desc_HeavyOilResidue_C"
	})
	d.Nodes = append(d.Nodes, testNode("external-fuel", "input", "Desc_LiquidFuel_C", 0))
	d, err := Expand(d, BundledCatalog())
	if err != nil {
		t.Fatal(err)
	}
	result := calculatePlan(t, d)
	for _, n := range d.Nodes {
		if n.ItemID == "Desc_PolymerResin_C" {
			for _, r := range result.Nodes {
				if r.NodeID == n.ID {
					for _, f := range r.Outputs {
						near(t, f.Rate, 0)
					}
				}
			}
		}
		if n.Surplus {
			for _, r := range result.Nodes {
				if r.NodeID == n.ID {
					near(t, r.EquivalentMachines, 0)
				}
			}
		}
	}
}

func TestSurplusInheritanceAndValidation(t *testing.T) {
	c := BundledCatalog()
	d := recycledPlan(0)
	group := testNode("group", "group", "", 0)
	d.Nodes = append(d.Nodes, group)
	for i := range d.Nodes {
		if d.Nodes[i].Kind != "group" {
			d.Nodes[i].ParentID = group.ID
		}
	}
	found := false
	for _, r := range EffectiveSettings(d, group.ID).Recipes {
		found = found || r.SurplusRecipeID != ""
	}
	if !found {
		t.Fatal("lost inherited surplus recipe")
	}
	expanded, err := Expand(d, c)
	if err != nil {
		t.Fatal(err)
	}
	calculatePlan(t, expanded)
	for i := range d.Nodes {
		if d.Nodes[i].ID == group.ID {
			d.Nodes[i].Settings.Recipes = []RecipeChoice{{ItemID: "Desc_Rubber_C", RecipeID: "Recipe_Alternate_RecycledRubber_C"}}
		}
	}
	expanded, err = Expand(d, c)
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range expanded.Nodes {
		if n.Surplus {
			t.Fatal("override failed to remove inherited surplus")
		}
	}
	for _, id := range []string{"missing", "Recipe_Alternate_RecycledRubber_C", "Recipe_IronPlate_C"} {
		invalid := recycledPlan(0)
		invalid.Settings.Recipes[1].SurplusRecipeID = id
		if Validate(invalid, c) == nil {
			t.Fatalf("accepted invalid surplus recipe %s", id)
		}
	}
}

func TestSurplusPreservesManualConnectionsAndNodeSettings(t *testing.T) {
	c := BundledCatalog()
	d, err := Expand(recycledPlan(300), c)
	if err != nil {
		t.Fatal(err)
	}
	surplusID := ""
	for i := range d.Nodes {
		if d.Nodes[i].Surplus {
			surplusID = d.Nodes[i].ID
			d.Nodes[i].Clock = 150
			d.Nodes[i].Status = "building"
		}
	}
	edgeID := ""
	for i := range d.Connections {
		if d.Connections[i].Target == surplusID && d.Connections[i].ItemID == "Desc_PolymerResin_C" {
			d.Connections[i].Generated = false
			edgeID = d.Connections[i].ID
		}
	}
	d, err = Expand(d, c)
	if err != nil {
		t.Fatal(err)
	}
	if nodeMap(d)[surplusID].Clock != 150 || nodeMap(d)[surplusID].Status != "building" {
		t.Fatal("expansion reset supplementary machine settings")
	}
	if !slices.ContainsFunc(d.Connections, func(e Connection) bool { return e.ID == edgeID && !e.Generated }) {
		t.Fatal("expansion dropped manual byproduct connection")
	}
	calculatePlan(t, d)
}

func TestSurplusDoesNotIncreaseOilToReplacePreferredRubber(t *testing.T) {
	c := BundledCatalog()
	d := recycledPlan(0)
	d.Nodes = append(d.Nodes,
		testNode("external-fuel", "input", "Desc_LiquidFuel_C", 0),
		testNode("heavy-oil-target", "output", "Desc_HeavyOilResidue_C", 400),
	)
	d, err := Expand(d, c)
	if err != nil {
		t.Fatal(err)
	}
	result := calculatePlan(t, d)
	nodes := nodeMap(d)
	for _, n := range result.Nodes {
		switch nodes[n.NodeID].RecipeID {
		case "Recipe_Alternate_HeavyOilResidue_C":
			near(t, n.Inputs[0].Rate, 300)
		case "Recipe_ResidualRubber_C":
			near(t, n.Outputs[0].Rate, 100)
		case "Recipe_Alternate_RecycledRubber_C":
			near(t, n.EquivalentMachines, 70.0/9)
		}
	}
}

func TestSurplusStopsWhenDemandIsCovered(t *testing.T) {
	c := BundledCatalog()
	d := recycledPlan(0)
	for i := range d.Nodes {
		d.Nodes[i].Rate = 10
	}
	d.Nodes = append(d.Nodes, testNode("external-fuel", "input", "Desc_LiquidFuel_C", 0), testNode("heavy-oil-target", "output", "Desc_HeavyOilResidue_C", 400))
	d, err := Expand(d, c)
	if err != nil {
		t.Fatal(err)
	}
	result := calculatePlan(t, d)
	nodes := nodeMap(d)
	for _, n := range result.Nodes {
		switch nodes[n.NodeID].RecipeID {
		case "Recipe_ResidualRubber_C":
			near(t, n.Outputs[0].Rate, 15)
		case "Recipe_Alternate_Plastic_1_C":
			near(t, n.Outputs[0].Rate, 10)
		case "Recipe_Alternate_RecycledRubber_C":
			near(t, n.EquivalentMachines, 0)
		}
	}
}

func TestSurplusSupportsRawResourcesAndOrdinaryMaterials(t *testing.T) {
	for _, tc := range []struct {
		item, preferred, secondary string
		rate                       float64
		supplies                   []Node
	}{
		{"Desc_CircuitBoardHighSpeed_C", "Recipe_Alternate_AILimiter_Plastic_C", "Recipe_AILimiter_C", 8, []Node{
			testNode("sheets", "supply", "Desc_CopperSheet_C", 100),
			testNode("quickwire", "supply", "Desc_HighSpeedWire_C", 200),
			testNode("plastic", "supply", "Desc_Plastic_C", 28),
		}},
		{"Desc_PolymerResin_C", "Recipe_Alternate_HeavyOilResidue_C", "Recipe_Alternate_PolymerResin_C", 130, []Node{
			testNode("oil", "supply", "Desc_LiquidOil_C", 400),
		}},
		{"Desc_PolymerResin_C", "Recipe_Alternate_PolymerResin_C", "Recipe_LiquidFuel_C", 30, []Node{
			testNode("oil", "supply", "Desc_LiquidOil_C", 200),
		}},
	} {
		t.Run(tc.secondary, func(t *testing.T) {
			d := testDocument()
			d.Settings.Recipes = []RecipeChoice{{ItemID: tc.item, RecipeID: tc.preferred, SurplusRecipeID: tc.secondary}}
			d.Nodes = append(tc.supplies, testNode("target", "output", tc.item, tc.rate))
			d, err := Expand(d, BundledCatalog())
			if err != nil {
				t.Fatal(err)
			}
			result := calculatePlan(t, d)
			secondary := 0.0
			for _, n := range result.Nodes {
				node := nodeMap(d)[n.NodeID]
				if node.RecipeID == tc.secondary && node.Surplus {
					for _, flow := range n.Outputs {
						if flow.ItemID == tc.item {
							secondary += flow.Rate
						}
					}
				}
				if node.Kind == "supply" {
					total := 0.0
					for _, flow := range n.Outputs {
						total += flow.Rate
					}
					if total > node.Rate+1e-5 {
						t.Fatal("exceeded available supply", node, n)
					}
				}
			}
			near(t, secondary, tc.rate)
		})
	}
}

func TestSurplusSharesFiniteMaterialBetweenRecipes(t *testing.T) {
	d := recycledPlan(0)
	d.Settings.Recipes[0].SurplusRecipeID = "Recipe_ResidualPlastic_C"
	d.Nodes = append(d.Nodes, testNode("fuel", "input", "Desc_LiquidFuel_C", 0), testNode("resin", "supply", "Desc_PolymerResin_C", 120))
	d, err := Expand(d, BundledCatalog())
	if err != nil {
		t.Fatal(err)
	}
	result := calculatePlan(t, d)
	resin := outputResult(t, result, "resin")
	total := 0.0
	for _, flow := range resin.Outputs {
		total += flow.Rate
	}
	if total > 120+1e-5 {
		t.Fatal("counted surplus twice", total)
	}
	if total < 1 {
		t.Fatal("available ordinary supply was unused")
	}
}

func TestSurplusUsesAvailableLinkedOutput(t *testing.T) {
	child := testDocument()
	out := testNode("sheets", "output", "Desc_CopperSheet_C", 100)
	out.Exposed = true
	child.Nodes = []Node{out}
	child = expandExport(t, child)
	imported := Diagram{ID: "child", SessionID: "s", Document: child}
	parent := testDocument()
	parent.Settings.Recipes = []RecipeChoice{{ItemID: "Desc_CircuitBoardHighSpeed_C", RecipeID: "Recipe_Alternate_AILimiter_Plastic_C", SurplusRecipeID: "Recipe_AILimiter_C"}}
	link := testNode("link", "link", "", 0)
	link.LinkedDiagramID = imported.ID
	parent.Nodes = []Node{link, testNode("target", "output", "Desc_CircuitBoardHighSpeed_C", 8)}
	parent = expandExport(t, parent, imported)
	results := solvePlan(t, imported, Diagram{ID: "parent", SessionID: "s", Document: parent})
	near(t, outputResult(t, results[0], out.ID).ExportRate, 40)
	supplied := 0.0
	for _, r := range results[1].Nodes {
		if nodeMap(parent)[r.NodeID].Surplus {
			supplied += r.Outputs[0].Rate
		}
	}
	near(t, supplied, 8)
}
