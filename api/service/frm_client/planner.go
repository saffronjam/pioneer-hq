package frm_client

import (
	"context"
	"fmt"
	"math"
	"slices"

	"api/internal/planner"
	"api/service/frm_client/frm_models"
	"strings"
)

// FetchPlannerCatalog imports known game recipes and unlocks with bundled machine metadata.
func FetchPlannerCatalog(ctx context.Context, address string) (planner.Catalog, error) {
	client := NewClientWithAddress(address)
	defer client.requestQueue.Stop()
	return client.GetPlannerCatalog(ctx)
}

// GetPlannerCatalog fetches a complete snapshot on the session request queue.
func (client *Client) GetPlannerCatalog(ctx context.Context) (planner.Catalog, error) {
	var recipes []frm_models.PlannerRecipe
	var schematics []frm_models.PlannerSchematic
	_, err := client.requestQueue.Enqueue("planner", func() error {
		if err := client.makeSatisfactoryCall(ctx, "/getRecipes", &recipes); err != nil {
			return err
		}
		return client.makeSatisfactoryCall(ctx, "/getSchematics", &schematics)
	})
	if err != nil {
		return planner.Catalog{}, err
	}
	if len(recipes) == 0 || len(schematics) == 0 {
		return planner.Catalog{}, fmt.Errorf("FRM returned an empty recipe or schematic catalog")
	}
	c := planner.BundledCatalog()
	index, _ := planner.NewIndex(c)
	unlocked, alternate := map[string]bool{}, map[string]bool{}
	for _, s := range schematics {
		for _, r := range s.Recipes {
			unlocked[r.ClassName] = unlocked[r.ClassName] || s.Purchased
			alternate[r.ClassName] = alternate[r.ClassName] || s.Type == "Alternate"
		}
	}
	c.Recipes = []planner.Recipe{}
	c.Unlocks = []planner.Unlock{}
	for _, raw := range recipes {
		for _, item := range append(append([]frm_models.PlannerItem{}, raw.Ingredients...), raw.Products...) {
			if !slices.Contains(c.ObservedItems, item.ClassName) {
				c.ObservedItems = append(c.ObservedItems, item.ClassName)
			}
		}
		machines := []string{}
		for _, id := range raw.ProducedIn {
			if _, ok := index.Machines[id]; ok {
				machines = append(machines, id)
			}
		}
		if len(machines) == 0 {
			for _, id := range raw.ProducedIn {
				if strings.HasPrefix(id, "Build_") {
					return c, fmt.Errorf("unknown producer %s; update the planner catalog", id)
				}
			}
			continue
		}
		r, ok := index.Recipes[raw.ClassName]
		if !ok {
			return c, fmt.Errorf("recipe %s has no bundled power metadata; update the planner catalog", raw.ClassName)
		}
		r.Name = raw.Name
		r.Duration = raw.FactoryDuration
		r.MachineIDs = machines
		r.Alternate = alternate[raw.ClassName]
		r.Ingredients = []planner.Amount{}
		r.Products = []planner.Amount{}
		for _, pair := range []struct {
			raw  []frm_models.PlannerItem
			dest *[]planner.Amount
		}{{raw.Ingredients, &r.Ingredients}, {raw.Products, &r.Products}} {
			for _, item := range pair.raw {
				expected := item.Amount * 60 / raw.FactoryDuration
				if math.IsNaN(expected) || math.IsInf(expected, 0) || math.Abs(expected-item.FactoryRate) > 1e-5*math.Max(1, math.Abs(expected)) {
					return c, fmt.Errorf("invalid rate for %s", raw.ClassName)
				}
				*pair.dest = append(*pair.dest, planner.Amount{ItemID: item.ClassName, Amount: item.Amount})
			}
		}
		c.Recipes = append(c.Recipes, r)
		c.Unlocks = append(c.Unlocks, planner.Unlock{RecipeID: r.ID, Unlocked: unlocked[r.ID]})
	}
	if len(c.Recipes) == 0 {
		return c, fmt.Errorf("FRM returned no supported production recipes")
	}
	slices.SortFunc(c.Recipes, func(a, b planner.Recipe) int {
		if a.ID < b.ID {
			return -1
		}
		if a.ID > b.ID {
			return 1
		}
		return 0
	})
	slices.SortFunc(c.Unlocks, func(a, b planner.Unlock) int {
		if a.RecipeID < b.RecipeID {
			return -1
		}
		if a.RecipeID > b.RecipeID {
			return 1
		}
		return 0
	})
	slices.Sort(c.ObservedItems)
	c.Version = planner.CatalogVersion(c)
	_, err = planner.NewIndex(c)
	return c, err
}

// PlannerUnlocks returns the latest complete schematic-derived recipe unlock list.
func (client *Client) PlannerUnlocks() []planner.Unlock {
	client.plannerMu.RLock()
	defer client.plannerMu.RUnlock()
	return slices.Clone(client.plannerUnlocks)
}
