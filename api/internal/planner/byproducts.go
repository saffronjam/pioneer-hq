package planner

import (
	"slices"

	"github.com/google/uuid"
)

func connectByproducts(d *Document, x *Index, oldEdges map[string]Connection) {
	type demand struct{ target, port, item string }
	type material struct{ scope, item string }
	nodes := nodeMap(*d)
	providers := map[material][]string{}
	for _, n := range d.Nodes {
		if n.Kind != "production" {
			continue
		}
		for _, product := range x.Recipes[n.RecipeID].Products {
			if product.ItemID != n.ItemID && !outputDisabled(n, product.ItemID) {
				key := material{n.ParentID, product.ItemID}
				providers[key] = append(providers[key], n.ID)
			}
		}
	}
	manual := map[demand]bool{}
	connected := map[demand]map[string]bool{}
	for _, e := range d.Connections {
		key := demand{e.Target, e.TargetPort, e.ItemID}
		manual[key] = manual[key] || (!e.Generated && !outputDisabled(nodes[e.Source], e.ItemID))
		if connected[key] == nil {
			connected[key] = map[string]bool{}
		}
		if e.SourcePort == "" {
			connected[key][e.Source] = true
		}
	}
	for _, edge := range slices.Clone(d.Connections) {
		key := demand{edge.Target, edge.TargetPort, edge.ItemID}
		if manual[key] {
			continue
		}
		target := nodes[edge.Target]
		scope := target.ParentID
		if target.Kind == "input" {
			if scope == "" {
				continue
			}
			scope = nodes[scope].ParentID
		}
		for _, source := range providers[material{scope, edge.ItemID}] {
			if connected[key][source] {
				continue
			}
			id := source + "//" + edge.Target + "/" + edge.TargetPort + "/" + edge.ItemID
			e, ok := oldEdges[id]
			if !ok {
				e = Connection{ID: uuid.NewString(), Source: source, Target: edge.Target, TargetPort: edge.TargetPort, ItemID: edge.ItemID, Generated: true}
			}
			d.Connections = append(d.Connections, e)
			connected[key][source] = true
		}
	}
}
