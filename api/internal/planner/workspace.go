package planner

import "context"

// Calculate balances each connected set of physical factories independently.
func Calculate(ctx context.Context, catalog Catalog, diagrams []Diagram, revision string) ([]Calculation, error) {
	if err := ValidateWorkspace(diagrams); err != nil {
		return nil, err
	}
	parent := map[string]string{}
	for _, d := range diagrams {
		parent[d.ID] = d.ID
	}
	var root func(string) string
	root = func(id string) string {
		if parent[id] != id {
			parent[id] = root(parent[id])
		}
		return parent[id]
	}
	for _, d := range diagrams {
		for _, n := range d.Document.Nodes {
			if n.Kind == "link" {
				parent[root(d.ID)] = root(n.LinkedDiagramID)
			}
		}
	}
	groups := map[string][]Diagram{}
	order := []string{}
	for _, d := range diagrams {
		id := root(d.ID)
		if _, ok := groups[id]; !ok {
			order = append(order, id)
		}
		groups[id] = append(groups[id], d)
	}
	byID := map[string]Calculation{}
	for _, id := range order {
		results, err := calculateAvailable(ctx, catalog, groups[id], revision)
		if err != nil {
			return nil, err
		}
		for _, r := range results {
			byID[r.DiagramID] = r
		}
	}
	results := make([]Calculation, 0, len(diagrams))
	for _, d := range diagrams {
		r := byID[d.ID]
		r.CalculationKey = d.CalculationKey
		results = append(results, r)
	}
	return results, nil
}
