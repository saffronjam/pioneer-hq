package frm_client_test

import (
	"api/internal/frmmock"
	"api/internal/planner"
	"api/service/frm_client"
	"api/service/frm_client/frm_models"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPlannerCatalogRefresh(t *testing.T) {
	c := planner.BundledCatalog()
	index, _ := planner.NewIndex(c)
	r := index.Recipes["Recipe_IronPlate_C"]
	for _, scenario := range []string{"valid", "alternate-unlock", "invalid-rate", "unknown-machine", "empty", "object"} {
		t.Run(scenario, func(t *testing.T) {
			raw := frm_models.PlannerRecipe{ClassName: r.ID, Name: r.Name, FactoryDuration: r.Duration, ProducedIn: r.MachineIDs}
			for _, a := range r.Ingredients {
				raw.Ingredients = append(raw.Ingredients, frm_models.PlannerItem{ClassName: a.ItemID, Amount: a.Amount, FactoryRate: a.Amount * 60 / r.Duration})
			}
			for _, a := range r.Products {
				raw.Products = append(raw.Products, frm_models.PlannerItem{ClassName: a.ItemID, Amount: a.Amount, FactoryRate: a.Amount * 60 / r.Duration})
			}
			if scenario == "invalid-rate" {
				raw.Products[0].FactoryRate++
			}
			if scenario == "unknown-machine" {
				raw.ProducedIn = []string{"Build_Unknown_C"}
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch req.URL.Path {
				case "/getRecipes":
					if scenario == "object" {
						json.NewEncoder(w).Encode(map[string]string{})
					} else if scenario == "empty" {
						json.NewEncoder(w).Encode([]frm_models.PlannerRecipe{})
					} else {
						json.NewEncoder(w).Encode([]frm_models.PlannerRecipe{raw})
					}
				case "/getSchematics":
					kind := "Milestone"
					if scenario == "alternate-unlock" {
						kind = "Alternate"
					}
					json.NewEncoder(w).Encode([]frm_models.PlannerSchematic{{Type: kind, Purchased: true, Recipes: []frm_models.PlannerRecipe{{ClassName: r.ID}}}})
				default:
					http.NotFound(w, req)
				}
			}))
			defer server.Close()
			result, err := frm_client.FetchPlannerCatalog(context.Background(), server.URL)
			if scenario != "valid" && scenario != "alternate-unlock" {
				if err == nil {
					t.Fatal("invalid snapshot accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Recipes) != 1 || len(result.Unlocks) != 1 || !result.Unlocks[0].Unlocked || result.Version == c.Version {
				t.Fatal(result.Version, result.Unlocks)
			}
			if result.Recipes[0].Alternate {
				t.Fatal("alternate schematic reclassified a standard recipe")
			}
		})
	}
}

func TestMockPlannerCatalog(t *testing.T) {
	mock, err := frmmock.NewServer(frmmock.Config{Preset: "industrial"})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(mock.Handler())
	defer server.Close()
	c, err := frm_client.FetchPlannerCatalog(context.Background(), server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Recipes) != 291 || len(c.Unlocks) != 291 {
		t.Fatal("mock catalog incomplete", len(c.Recipes), len(c.Unlocks))
	}
}
