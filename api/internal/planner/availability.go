package planner

import (
	"context"
	"slices"
)

// calculateAvailable isolates unavailable material networks without discarding authored nodes.
func calculateAvailable(ctx context.Context, c Catalog, ds []Diagram, revision string) ([]Calculation, error) {
	ds = slices.Clone(ds)
	for i := range ds {
		nodes := nodeMap(ds[i].Document)
		ds[i].Document.Connections = slices.DeleteFunc(slices.Clone(ds[i].Document.Connections), func(e Connection) bool {
			return outputDisabled(nodes[e.Source], e.ItemID)
		})
	}
	x, err := NewIndex(c)
	if err != nil {
		return nil, err
	}
	blocked := map[string]bool{}
	adjacent := map[string][]string{}
	connect := func(a, b string) { adjacent[a] = append(adjacent[a], b); adjacent[b] = append(adjacent[b], a) }
	for _, d := range ds {
		for _, n := range d.Document.Nodes {
			key := d.ID + "/" + n.ID
			if x.Items[n.ItemID].Unavailable || x.Recipes[n.RecipeID].Unavailable {
				blocked[key] = true
			}
			if n.Kind == "link" {
				for _, child := range ds {
					if child.ID == n.LinkedDiagramID {
						for _, cn := range child.Document.Nodes {
							if cn.Kind != "group" {
								connect(key, child.ID+"/"+cn.ID)
							}
						}
					}
				}
			}
		}
		for _, e := range d.Document.Connections {
			connect(d.ID+"/"+e.Source, d.ID+"/"+e.Target)
			if x.Items[e.ItemID].Unavailable {
				blocked[d.ID+"/"+e.Source] = true
			}
		}
	}
	queue := []string{}
	for key := range blocked {
		queue = append(queue, key)
	}
	for len(queue) > 0 {
		key := queue[0]
		queue = queue[1:]
		for _, next := range adjacent[key] {
			if !blocked[next] {
				blocked[next] = true
				queue = append(queue, next)
			}
		}
	}
	filtered := slices.Clone(ds)
	for i, d := range ds {
		filtered[i].Document.Nodes = slices.DeleteFunc(slices.Clone(d.Document.Nodes), func(n Node) bool { return blocked[d.ID+"/"+n.ID] })
		filtered[i].Document.Connections = slices.DeleteFunc(slices.Clone(d.Document.Connections), func(e Connection) bool { return blocked[d.ID+"/"+e.Source] || blocked[d.ID+"/"+e.Target] })
	}
	results, err := calculateComponent(ctx, c, filtered, revision)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		results = []Calculation{}
		for _, d := range ds {
			results = append(results, Calculation{DiagramID: d.ID, Revision: d.Revision, CatalogVersion: c.Version, WorkspaceRevision: revision, Nodes: []NodeResult{}, Connections: []ConnectionResult{}, Diagnostics: []Diagnostic{{DiagramID: d.ID, Code: "unresolved", Message: err.Error()}}})
		}
		return results, nil
	}
	for i, d := range ds {
		for _, n := range d.Document.Nodes {
			if blocked[d.ID+"/"+n.ID] {
				results[i].Resolved = false
				message := "Calculation depends on an unavailable item or recipe"
				if x.Items[n.ItemID].Unavailable {
					message = "Item unavailable"
				} else if x.Recipes[n.RecipeID].Unavailable {
					message = "Recipe unavailable"
				}
				results[i].Diagnostics = append(results[i].Diagnostics, Diagnostic{DiagramID: d.ID, NodeID: n.ID, ItemID: n.ItemID, Code: "unavailable", Message: message})
			}
		}
	}
	return results, nil
}
