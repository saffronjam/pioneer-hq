package planner

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
)

//go:embed catalog.json
var catalogJSON []byte

// BundledCatalog returns a fresh copy of the embedded vanilla catalog.
func BundledCatalog() Catalog {
	var c Catalog
	if err := json.Unmarshal(catalogJSON, &c); err != nil {
		panic(err)
	}
	return c
}

// Index provides stable class-name lookup for a catalog.
type Index struct {
	Items     map[string]Item
	Recipes   map[string]Recipe
	Machines  map[string]Machine
	Producing map[string][]Recipe
}

// NewIndex validates a catalog before exposing it to the solver.
func NewIndex(c Catalog) (*Index, error) {
	x := &Index{Items: map[string]Item{}, Recipes: map[string]Recipe{}, Machines: map[string]Machine{}, Producing: map[string][]Recipe{}}
	for _, i := range c.Items {
		if i.ID == "" || x.Items[i.ID].ID != "" {
			return nil, fmt.Errorf("invalid or duplicate item %q", i.ID)
		}
		if i.Form != "solid" && i.Form != "liquid" && i.Form != "gas" {
			return nil, fmt.Errorf("unknown item form: %s", i.ID)
		}
		x.Items[i.ID] = i
	}
	for _, m := range c.Machines {
		if m.ID == "" || x.Machines[m.ID].ID != "" || !finite(m.Power) || m.Power < 0 || m.BoostSlots < 0 || !finite(m.PowerExponent) || !finite(m.BoostPowerExponent) || !finite(m.BoostPerSlot) || m.BoostPerSlot < 0 || !positive(m.MinClock) || !positive(m.MaxClock) || m.MinClock > m.MaxClock {
			return nil, fmt.Errorf("invalid machine %q", m.ID)
		}
		x.Machines[m.ID] = m
	}
	for _, r := range c.Recipes {
		if r.ID == "" || x.Recipes[r.ID].ID != "" || !positive(r.Duration) || len(r.Products) == 0 || len(r.MachineIDs) == 0 || !finite(r.PowerConstant) || !finite(r.PowerFactor) || r.PowerConstant < 0 || r.PowerFactor < 0 {
			return nil, fmt.Errorf("invalid recipe %q", r.ID)
		}
		for _, id := range r.MachineIDs {
			if x.Machines[id].ID == "" {
				return nil, fmt.Errorf("recipe %s: unknown machine %s", r.ID, id)
			}
		}
		for _, amounts := range [][]Amount{r.Ingredients, r.Products} {
			seen := map[string]bool{}
			for _, a := range amounts {
				if x.Items[a.ItemID].ID == "" || !positive(a.Amount) || seen[a.ItemID] {
					return nil, fmt.Errorf("recipe %s: invalid material %s", r.ID, a.ItemID)
				}
				seen[a.ItemID] = true
			}
		}
		x.Recipes[r.ID] = r
		for _, a := range r.Products {
			if r.Unavailable {
				continue
			}
			x.Producing[a.ItemID] = append(x.Producing[a.ItemID], r)
		}
	}
	if len(c.Belts) != 6 || len(c.Pipes) != 2 {
		return nil, fmt.Errorf("incomplete transport catalog")
	}
	for _, rates := range [][]float64{c.Belts, c.Pipes} {
		for _, rate := range rates {
			if !positive(rate) {
				return nil, fmt.Errorf("invalid transport capacity")
			}
		}
	}
	return x, nil
}

func finite(v float64) bool   { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func positive(v float64) bool { return finite(v) && v > 0 }
