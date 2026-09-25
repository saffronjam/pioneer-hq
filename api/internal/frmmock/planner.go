package frmmock

import (
	"api/internal/planner"
	"api/service/frm_client/frm_models"
)

func renderPlannerRecipes() []frm_models.PlannerRecipe {
	c := planner.BundledCatalog()
	out := make([]frm_models.PlannerRecipe, 0, len(c.Recipes))
	for _, r := range c.Recipes {
		raw := frm_models.PlannerRecipe{ClassName: r.ID, Name: r.Name, FactoryDuration: r.Duration, ProducedIn: r.MachineIDs, Ingredients: []frm_models.PlannerItem{}, Products: []frm_models.PlannerItem{}}
		for _, a := range r.Ingredients {
			raw.Ingredients = append(raw.Ingredients, frm_models.PlannerItem{ClassName: a.ItemID, Amount: a.Amount, FactoryRate: a.Amount * 60 / r.Duration})
		}
		for _, a := range r.Products {
			raw.Products = append(raw.Products, frm_models.PlannerItem{ClassName: a.ItemID, Amount: a.Amount, FactoryRate: a.Amount * 60 / r.Duration})
		}
		out = append(out, raw)
	}
	return out
}

func renderPlannerSchematics(w *World) []frm_models.Schematic {
	c := planner.BundledCatalog()
	out := []frm_models.Schematic{}
	for _, r := range c.Recipes {
		kind := "Milestone"
		if r.Alternate {
			kind = "Alternate"
		}
		out = append(out, frm_models.Schematic{ID: "mock-" + r.ID, Name: r.Name, Type: kind, Purchased: !r.Alternate || w.Phase >= 3, TechTier: 1, Cost: []frm_models.SchematicCost{}, Recipes: []frm_models.PlannerRecipe{{ClassName: r.ID}}})
	}
	return out
}
