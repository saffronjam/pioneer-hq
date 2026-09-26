package planner

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"
)

func surplusRecipe(d Document, n Node) string {
	for _, choice := range EffectiveSettings(d, n.ParentID).Recipes {
		if choice.ItemID == n.ItemID {
			return choice.SurplusRecipeID
		}
	}
	return ""
}

func expandSurplus(d *Document, x *Index, oldNodes map[string]Node, oldEdges map[string]Connection, diagrams []Diagram, ensure func(string, string, string, string, map[string]string) error) error {
	connect := func(source, sourcePort, target, targetPort, item string) {
		if outputDisabled(nodeMap(*d)[source], item) {
			return
		}
		for _, e := range d.Connections {
			if e.Source == source && e.SourcePort == sourcePort && e.Target == target && e.TargetPort == targetPort && e.ItemID == item {
				return
			}
		}
		key := source + "/" + sourcePort + "/" + target + "/" + targetPort + "/" + item
		edge, ok := oldEdges[key]
		if !ok {
			edge = Connection{ID: uuid.NewString(), Source: source, SourcePort: sourcePort, Target: target, TargetPort: targetPort, ItemID: item, Generated: true}
		}
		d.Connections = append(d.Connections, edge)
	}
	handled := map[string]bool{}
	for i := 0; i < len(d.Nodes); i++ {
		primary := d.Nodes[i]
		if primary.Kind != "production" {
			continue
		}
		recipeID := surplusRecipe(*d, primary)
		key := primary.ParentID + "/" + primary.ItemID + "/" + recipeID
		if recipeID == "" || handled[key] {
			continue
		}
		handled[key] = true
		r := x.Recipes[recipeID]
		targets := []Connection{}
		nm := nodeMap(*d)
		for _, edge := range d.Connections {
			source := nm[edge.Source]
			if source.Kind == "production" && !source.Surplus && source.ParentID == primary.ParentID && source.ItemID == primary.ItemID && edge.ItemID == primary.ItemID && edge.Generated {
				targets = append(targets, edge)
			}
		}
		n, exists := oldNodes[key]
		retained := exists && nm[n.ID].ID != ""
		if len(targets) == 0 && !retained {
			continue
		}
		if !exists {
			n = Node{ID: uuid.NewString(), Kind: "production", ParentID: primary.ParentID, Name: x.Items[primary.ItemID].Name, ItemID: primary.ItemID, RecipeID: recipeID, MachineID: r.MachineIDs[0], X: primary.X, Y: primary.Y + 200, Width: 240, Height: 140, Clock: 100, Status: "planned", Generated: true, Surplus: true, Settings: Settings{Recipes: []RecipeChoice{}}}
		}
		if !retained {
			if len(d.Nodes) >= 1000 {
				return fmt.Errorf("expanded diagram exceeds 1000 nodes")
			}
			d.Nodes = append(d.Nodes, n)
		}
		for _, edge := range targets {
			connect(n.ID, "", edge.Target, edge.TargetPort, edge.ItemID)
		}
		for _, ingredient := range r.Ingredients {
			if slices.ContainsFunc(d.Connections, func(e Connection) bool {
				return e.Target == n.ID && e.ItemID == ingredient.ItemID && !e.Generated && !outputDisabled(nm[e.Source], e.ItemID)
			}) {
				continue
			}
			for _, source := range slices.Clone(d.Nodes) {
				if source.ID == n.ID || source.Surplus {
					continue
				}
				if source.ParentID == n.ParentID && (source.Kind == "production" && hasAmount(x.Recipes[source.RecipeID].Products, ingredient.ItemID) ||
					(source.Kind == "supply" || source.Kind == "input") && source.ItemID == ingredient.ItemID) {
					connect(source.ID, "", n.ID, "", ingredient.ItemID)
				}
				if source.Kind == "output" && source.Exposed && source.ItemID == ingredient.ItemID && source.ParentID != "" && nm[source.ParentID].ParentID == n.ParentID {
					connect(source.ID, "", n.ID, "", ingredient.ItemID)
				}
				if source.Kind == "link" && source.ParentID == n.ParentID {
					for _, child := range diagrams {
						if child.ID != source.LinkedDiagramID {
							continue
						}
						for _, output := range child.Document.Nodes {
							if output.Kind == "output" && output.Exposed && output.ItemID == ingredient.ItemID {
								connect(source.ID, output.ID, n.ID, "", ingredient.ItemID)
							}
						}
					}
				}
			}
			if err := ensure(n.ID, "", ingredient.ItemID, n.ParentID, map[string]string{}); err != nil {
				return err
			}
		}
	}
	return nil
}

type surplusFeed struct {
	source, target, item string
	variable             int
}

// solveSurplus reserves existing excess material for supplementary recipes. Each
// cycle must consume an equivalent share of that excess; other ingredients are
// supplied normally. A supplier cannot increase production to create more excess.
func (p *program) solveSurplus(ctx context.Context, nodes map[string]compiledNode, residuals []surplus, feeds []surplusFeed, outgoing map[port]map[int]float64) ([]float64, error) {
	keys := make([]string, 0, len(nodes))
	supplemented := map[string]bool{}
	for key, cn := range nodes {
		if cn.node.Surplus {
			keys = append(keys, key)
			supplemented[cn.diagram+"/"+cn.node.ParentID+"/"+cn.node.ItemID] = true
		}
	}
	if len(keys) == 0 {
		return p.solve(ctx)
	}
	slices.Sort(keys)
	baseline := *p
	baseline.rows = slices.Clone(p.rows)
	for stage := range p.costs {
		baseline.costs[stage] = slices.Clone(p.costs[stage])
	}
	for _, key := range keys {
		baseline.le(map[int]float64{nodes[key].activity: 1}, 0)
	}
	values, err := baseline.solve(ctx)
	if err != nil {
		return nil, err
	}

	available := map[port]float64{}
	for _, residual := range residuals {
		available[port{residual.diagram + "/" + residual.node, residual.item}] = values[residual.variable]
	}
	for key, cn := range nodes {
		n := cn.node
		if n.Kind == "supply" || n.Kind == "input" && n.InputRateMode == "fixed" || n.Kind == "output" && n.Exposed && n.OutputRateMode != "demand" {
			remaining := n.Rate
			for variable := range outgoing[port{key, n.ItemID}] {
				remaining -= values[variable]
			}
			available[port{key, n.ItemID}] = max(0, remaining)
		}
	}
	credits := map[port]map[int]float64{}
	coverage := map[string]map[int]float64{}
	suppliers := map[int]bool{}
	for _, feed := range feeds {
		source := port{feed.source, feed.item}
		if available[source] < 1e-6 {
			continue
		}
		cn := nodes[feed.target]
		rate := 0.0
		for _, ingredient := range cn.recipe.Ingredients {
			if ingredient.ItemID == feed.item {
				rate = ingredient.Amount * 60 / cn.recipe.Duration * cn.node.Clock / 100
			}
		}
		if rate <= 0 {
			continue
		}
		credit := p.variable(activityObjective, 0)
		p.le(map[int]float64{credit: 1, feed.variable: -1}, 0)
		if credits[source] == nil {
			credits[source] = map[int]float64{}
		}
		credits[source][credit] = 1
		if coverage[feed.target] == nil {
			coverage[feed.target] = map[int]float64{}
		}
		coverage[feed.target][credit] = -1 / rate
		if producer := nodes[feed.source]; producer.node.Kind == "production" {
			suppliers[producer.activity] = true
		}
	}
	ports := make([]port, 0, len(credits))
	for source := range credits {
		ports = append(ports, source)
	}
	slices.SortFunc(ports, func(a, b port) int {
		if n := strings.Compare(a.node, b.node); n != 0 {
			return n
		}
		return strings.Compare(a.item, b.item)
	})
	for _, source := range ports {
		p.le(credits[source], available[source])
	}
	for _, key := range keys {
		cn := nodes[key]
		if len(cn.recipe.Ingredients) == 0 {
			continue
		}
		row := cloneCoefficients(coverage[key])
		row[cn.activity] = 1
		p.le(row, 0)
	}
	activities := make([]int, 0, len(suppliers))
	for activity := range suppliers {
		activities = append(activities, activity)
	}
	slices.Sort(activities)
	for _, activity := range activities {
		p.le(map[int]float64{activity: 1}, values[activity])
		p.costs[surplusProductionObjective][activity] = 1
	}
	for _, cn := range nodes {
		if cn.node.Kind == "production" && !cn.node.Surplus && supplemented[cn.diagram+"/"+cn.node.ParentID+"/"+cn.node.ItemID] {
			p.costs[surplusUseObjective][cn.activity] = 1
		}
	}
	return p.solve(ctx)
}
