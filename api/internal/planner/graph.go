package planner

import (
	"fmt"
	"math"
	"reflect"
	"slices"
	"strings"

	"github.com/google/uuid"
)

// Validate checks editable structure independently of whether production is feasible.
func Validate(d Document, catalog Catalog) error {
	x, err := NewIndex(catalog)
	if err != nil {
		return err
	}
	if d.Version != 1 || strings.TrimSpace(d.Name) == "" || len(d.Name) > 200 {
		return fmt.Errorf("diagram requires a name and document version 1")
	}
	if len(d.Nodes) > 1000 || len(d.Connections) > 4000 {
		return fmt.Errorf("diagram exceeds 1000 nodes or 4000 connections")
	}
	if !positive(d.Viewport.Zoom) || !finite(d.Viewport.X) || !finite(d.Viewport.Y) {
		return fmt.Errorf("invalid viewport")
	}
	nodes := nodeMap(d)
	if len(nodes) != len(d.Nodes) {
		return fmt.Errorf("duplicate node ID")
	}
	settings := []Settings{d.Settings}
	for _, n := range d.Nodes {
		if n.ID == "" || !slices.Contains([]string{"group", "production", "supply", "input", "output", "link"}, n.Kind) {
			return fmt.Errorf("invalid node %q", n.ID)
		}
		if !slices.Contains([]string{"planned", "building", "built"}, n.Status) {
			return fmt.Errorf("invalid build status on %s", n.ID)
		}
		for _, v := range []float64{n.X, n.Y, n.Width, n.Height, n.Rate, n.Clock} {
			if !finite(v) {
				return fmt.Errorf("non-finite node value: %s", n.ID)
			}
		}
		if n.OutputRateMode != "" && n.OutputRateMode != "fixed" && n.OutputRateMode != "demand" {
			return fmt.Errorf("invalid output rate mode")
		}
		if n.Exposed && n.Kind != "output" {
			return fmt.Errorf("only output targets can be exposed")
		}
		if n.OutputRateMode == "demand" && (n.Kind != "output" || !n.Exposed) {
			return fmt.Errorf("demand-driven outputs must be exposed")
		}
		if n.InputRateMode != "" && n.InputRateMode != "calculated" && n.InputRateMode != "fixed" {
			return fmt.Errorf("invalid required input mode")
		}
		if n.Kind == "input" && n.InputRateMode == "fixed" && !positive(n.Rate) {
			return fmt.Errorf("fixed required input needs a positive rate")
		}
		if n.Rate < 0 || n.Rate > 1e9 || n.Width < 0 || n.Height < 0 {
			return fmt.Errorf("invalid dimensions or rate: %s", n.ID)
		}
		if n.Kind != "group" && n.Kind != "link" && x.Items[n.ItemID].ID == "" {
			return fmt.Errorf("unknown material on %s", n.ID)
		}
		if n.Kind == "link" && n.LinkedDiagramID == "" {
			return fmt.Errorf("factory link requires a diagram")
		}
		if n.Kind != "group" && (len(n.Settings.Recipes) > 0 || n.Settings.BeltTier != 0 || n.Settings.PipeTier != 0) {
			return fmt.Errorf("production policies belong to groups: %s", n.ID)
		}
		seen := map[string]bool{n.ID: true}
		for p := n.ParentID; p != ""; p = nodes[p].ParentID {
			if seen[p] || nodes[p].Kind != "group" {
				return fmt.Errorf("invalid group hierarchy at %s", n.ID)
			}
			seen[p] = true
		}
		if n.Kind == "production" {
			r, ok := x.Recipes[n.RecipeID]
			if !ok {
				return fmt.Errorf("unknown recipe on %s", n.ID)
			}
			m := x.Machines[n.MachineID]
			if !slices.Contains(r.MachineIDs, n.MachineID) || n.Clock < m.MinClock || n.Clock > m.MaxClock || n.Somersloops < 0 || n.Somersloops > m.BoostSlots {
				return fmt.Errorf("invalid machine, clock, or Somersloops on %s", n.ID)
			}
		}
		if n.Surplus && n.Kind != "production" {
			return fmt.Errorf("surplus recipes require a production node")
		}
		for _, item := range n.DisabledOutputs {
			if n.Kind != "production" || !hasAmount(x.Recipes[n.RecipeID].Products, item) {
				return fmt.Errorf("disabled output must belong to the recipe on %s", n.ID)
			}
		}
		settings = append(settings, n.Settings)
	}
	for _, s := range settings {
		if s.BeltTier < 0 || s.BeltTier > len(catalog.Belts) || s.PipeTier < 0 || s.PipeTier > len(catalog.Pipes) {
			return fmt.Errorf("invalid belt or pipe tier")
		}
		seen := map[string]bool{}
		for _, choice := range s.Recipes {
			r, ok := x.Recipes[choice.RecipeID]
			if !ok || !hasAmount(r.Products, choice.ItemID) || seen[choice.ItemID] {
				return fmt.Errorf("invalid recipe choice for %s", choice.ItemID)
			}
			if choice.SurplusRecipeID != "" {
				r, ok := x.Recipes[choice.SurplusRecipeID]
				if !ok || r.ID == choice.RecipeID || !hasAmount(r.Products, choice.ItemID) {
					return fmt.Errorf("invalid surplus recipe for %s", choice.ItemID)
				}
			}
			seen[choice.ItemID] = true
		}
	}
	edges := map[string]bool{}
	for _, e := range d.Connections {
		if e.ID == "" || edges[e.ID] || nodes[e.Source].ID == "" || nodes[e.Target].ID == "" || x.Items[e.ItemID].ID == "" {
			return fmt.Errorf("invalid connection %s", e.ID)
		}
		if nodes[e.Source].Kind == "group" || nodes[e.Target].Kind == "group" {
			return fmt.Errorf("connect to a section's underlying material port")
		}
		if nodes[e.Source].Kind == "output" && !nodes[e.Source].Exposed {
			return fmt.Errorf("output must be exposed before connecting consumers")
		}
		if e.AvailableLines != nil && (*e.AvailableLines < 0 || *e.AvailableLines > 1000000) {
			return fmt.Errorf("invalid transport count")
		}
		edges[e.ID] = true
	}
	visiting, done := map[string]bool{}, map[string]bool{}
	var visit func(string) error
	visit = func(id string) error {
		if nodes[id].Kind == "production" || done[id] {
			return nil
		}
		if visiting[id] {
			return fmt.Errorf("boundary ports cannot form a supply loop without a production recipe")
		}
		visiting[id] = true
		for _, e := range d.Connections {
			if e.Source == id {
				if err := visit(e.Target); err != nil {
					return err
				}
			}
		}
		delete(visiting, id)
		done[id] = true
		return nil
	}
	for _, n := range d.Nodes {
		if err := visit(n.ID); err != nil {
			return err
		}
	}
	return nil
}

func nodeMap(d Document) map[string]Node {
	m := map[string]Node{}
	for _, n := range d.Nodes {
		m[n.ID] = n
	}
	return m
}
func hasAmount(as []Amount, id string) bool {
	for _, a := range as {
		if a.ItemID == id {
			return true
		}
	}
	return false
}

func outputDisabled(n Node, item string) bool {
	return n.Kind == "production" && slices.Contains(n.DisabledOutputs, item)
}

// EffectiveSettings resolves independent policy fields from the nearest ancestor.
func EffectiveSettings(d Document, scope string) Settings {
	nodes := nodeMap(d)
	out := Settings{BeltTier: 1, PipeTier: 1, Recipes: []RecipeChoice{}}
	chain := []Settings{d.Settings}
	seen := map[string]bool{}
	for scope != "" && !seen[scope] {
		seen[scope] = true
		n, ok := nodes[scope]
		if !ok {
			break
		}
		chain = append(chain, n.Settings)
		scope = n.ParentID
	}
	if len(chain) > 1 {
		slices.Reverse(chain[1:])
	}
	choices := map[string]RecipeChoice{}
	for _, s := range chain {
		if s.BeltTier > 0 {
			out.BeltTier = s.BeltTier
		}
		if s.PipeTier > 0 {
			out.PipeTier = s.PipeTier
		}
		for _, r := range s.Recipes {
			choices[r.ItemID] = r
		}
	}
	keys := make([]string, 0, len(choices))
	for k := range choices {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, k := range keys {
		out.Recipes = append(out.Recipes, choices[k])
	}
	return out
}

// ConnectionScope returns the nearest common containing group of two nodes.
func ConnectionScope(d Document, source, target string) string {
	nodes := nodeMap(d)
	parents := map[string]bool{"": true}
	for p := nodes[source].ParentID; p != ""; p = nodes[p].ParentID {
		parents[p] = true
	}
	for p := nodes[target].ParentID; p != ""; p = nodes[p].ParentID {
		if parents[p] {
			return p
		}
	}
	return ""
}

func chooseRecipe(d Document, scope, item string, x *Index) (Recipe, bool) {
	for _, r := range EffectiveSettings(d, scope).Recipes {
		if r.ItemID == item {
			v, ok := x.Recipes[r.RecipeID]
			return v, ok
		}
	}
	if x.Items[item].Resource {
		return Recipe{}, false
	}
	var candidates []Recipe
	var alternatives []Recipe
	for _, r := range x.Producing[item] {
		if strings.HasPrefix(r.ID, "Recipe_Unpackage") || r.Products[0].ItemID != item {
			continue
		}
		if !r.Alternate {
			if strings.EqualFold(r.Name, x.Items[item].Name) {
				return r, true
			}
			candidates = append(candidates, r)
		} else {
			alternatives = append(alternatives, r)
		}
	}
	if len(candidates) == 1 {
		return candidates[0], true
	}
	if len(candidates) == 0 && len(alternatives) == 1 {
		return alternatives[0], true
	}
	return Recipe{}, false
}

// Expand fills unconnected target and production inputs within their own scope.
func Expand(d Document, catalog Catalog, diagrams ...Diagram) (Document, error) {
	before := nodeMap(d)
	d.Connections = slices.DeleteFunc(slices.Clone(d.Connections), func(e Connection) bool {
		return e.Generated && before[e.Source].Kind == "output" && !before[e.Source].Exposed
	})
	if err := Validate(d, catalog); err != nil {
		return d, err
	}
	x, _ := NewIndex(catalog)
	converted := map[string]bool{}
	for i := range d.Nodes {
		n := &d.Nodes[i]
		if n.Surplus {
			continue
		}
		if n.Kind == "production" || (n.Kind == "input" && n.Generated) {
			if x.Recipes[n.RecipeID].Unavailable {
				continue
			}
			if r, ok := chooseRecipe(d, n.ParentID, n.ItemID, x); ok && r.ID != n.RecipeID {
				n.Kind = "production"
				n.RecipeID = r.ID
				if !slices.Contains(r.MachineIDs, n.MachineID) {
					n.MachineID = r.MachineIDs[0]
				}
				machine := x.Machines[n.MachineID]
				n.Somersloops = min(n.Somersloops, machine.BoostSlots)
				n.Clock = math.Max(machine.MinClock, math.Min(machine.MaxClock, n.Clock))
				n.DisabledOutputs = slices.DeleteFunc(slices.Clone(n.DisabledOutputs), func(item string) bool { return !hasAmount(r.Products, item) })
			} else if !ok && n.Kind == "production" {
				n.Kind = "input"
				n.RecipeID = ""
				n.MachineID = ""
				n.Somersloops = 0
				n.DisabledOutputs = nil
				converted[n.ID] = true
			}
		}
	}
	nodes := nodeMap(d)
	d.Connections = slices.DeleteFunc(d.Connections, func(e Connection) bool {
		s, t := nodes[e.Source], nodes[e.Target]
		return converted[e.Target] || (s.Kind == "production" && !hasAmount(x.Recipes[s.RecipeID].Products, e.ItemID)) || (t.Kind == "production" && !hasAmount(x.Recipes[t.RecipeID].Ingredients, e.ItemID))
	})
	manualSources := map[string]bool{}
	for _, e := range d.Connections {
		if !e.Generated {
			manualSources[e.Source] = true
		}
	}
	oldEdges := map[string]Connection{}
	edgeKey := func(source, sourcePort, target, targetPort, item string) string {
		return source + "/" + sourcePort + "/" + target + "/" + targetPort + "/" + item
	}
	for _, e := range d.Connections {
		if e.Generated {
			oldEdges[edgeKey(e.Source, e.SourcePort, e.Target, e.TargetPort, e.ItemID)] = e
		}
	}
	oldSurplus := map[string]Node{}
	removedSurplus := map[string]bool{}
	for _, n := range d.Nodes {
		if n.Surplus {
			oldSurplus[n.ParentID+"/"+n.ItemID+"/"+n.RecipeID] = n
			removedSurplus[n.ID] = surplusRecipe(d, n) != n.RecipeID
		}
	}
	d.Nodes = slices.DeleteFunc(slices.Clone(d.Nodes), func(n Node) bool { return removedSurplus[n.ID] })
	d.Connections = slices.DeleteFunc(d.Connections, func(e Connection) bool { return removedSurplus[e.Source] || removedSurplus[e.Target] })
	d.Connections = slices.DeleteFunc(slices.Clone(d.Connections), func(e Connection) bool { return e.Generated })
	exportPorts := map[string]string{}
	visited := map[string]bool{}
	var ensure func(string, string, string, string, map[string]string) error
	ensure = func(target, targetPort, item, scope string, ancestors map[string]string) error {
		key := target + "/" + targetPort + "/" + item
		if visited[key] {
			return nil
		}
		visited[key] = true
		for _, e := range d.Connections {
			if e.Target == target && e.TargetPort == targetPort && e.ItemID == item && !outputDisabled(nodeMap(d)[e.Source], item) {
				return nil
			}
		}
		t := nodeMap(d)[target]
		anchor := t
		for anchor.ParentID != scope && anchor.ParentID != "" {
			anchor = nodeMap(d)[anchor.ParentID]
		}
		providers := []string{}
		required := ""
		production := ""
		fallback := ""
		for _, n := range d.Nodes {
			if n.ParentID != scope || n.ItemID != item || n.ID == target {
				continue
			}
			switch n.Kind {
			case "supply":
				providers = append(providers, n.ID)
			case "input":
				if !n.Generated {
					if required == "" {
						required = n.ID
					}
				} else if fallback == "" {
					fallback = n.ID
				}
			case "production":
				if production == "" && !n.Surplus && !outputDisabled(n, item) {
					production = n.ID
				}
			}
		}
		exports := []string{}
		demandExport := false
		for _, n := range d.Nodes {
			if n.Kind == "output" && n.Exposed && n.ItemID == item && n.ID != target && n.ParentID != "" && nodeMap(d)[n.ParentID].ParentID == scope && n.ParentID != anchor.ID {
				exports = append(exports, n.ID)
				demandExport = demandExport || n.OutputRateMode == "demand"
			}
			if n.Kind == "link" && n.ParentID == scope && n.ID != target {
				for _, child := range diagrams {
					if child.ID != n.LinkedDiagramID {
						continue
					}
					for _, out := range child.Document.Nodes {
						if out.Kind == "output" && out.Exposed && out.ItemID == item {
							provider := n.ID + "/" + out.ID
							exports = append(exports, provider)
							exportPorts[provider] = out.ID
							demandExport = demandExport || out.OutputRateMode == "demand"
						}
					}
				}
			}
		}
		if required != "" {
			providers = append(providers, required)
		} else if demandExport {
			providers = append(providers, exports...)
		} else {
			providers = append(providers, exports...)
			r, produces := chooseRecipe(d, scope, item, x)
			if produces || len(providers) == 0 {
				provider := production
				if provider == "" {
					provider = ancestors[item]
					if outputDisabled(nodeMap(d)[provider], item) {
						provider = ""
					}
				}
				if provider == "" && !produces {
					provider = fallback
				}
				if provider == "" {
					if len(d.Nodes) >= 1000 {
						return fmt.Errorf("expanded diagram exceeds 1000 nodes")
					}
					n := Node{ID: uuid.NewString(), Generated: true, Kind: "input", InputRateMode: "calculated", ParentID: scope, Name: x.Items[item].Name, ItemID: item, X: anchor.X - 310, Y: anchor.Y, Width: 240, Height: 140, Clock: 100, Status: "planned", Settings: Settings{Recipes: []RecipeChoice{}}}
					if produces {
						n.Kind = "production"
						n.RecipeID = r.ID
						n.MachineID = r.MachineIDs[0]
					}
					d.Nodes = append(d.Nodes, n)
					provider = n.ID
				}
				providers = append(providers, provider)
			}
		}
		for _, provider := range providers {
			portID := exportPorts[provider]
			if portID != "" {
				provider = strings.TrimSuffix(provider, "/"+portID)
			}
			e, ok := oldEdges[edgeKey(provider, portID, target, targetPort, item)]
			if !ok {
				e = Connection{ID: uuid.NewString(), Source: provider, SourcePort: portID, Target: target, TargetPort: targetPort, ItemID: item, Generated: true}
			}
			d.Connections = append(d.Connections, e)
			n := nodeMap(d)[provider]
			if n.Kind == "production" {
				next := map[string]string{}
				for k, v := range ancestors {
					next[k] = v
				}
				next[item] = provider
				for _, a := range x.Recipes[n.RecipeID].Ingredients {
					if err := ensure(provider, "", a.ItemID, n.ParentID, next); err != nil {
						return err
					}
				}
			}
		}
		return nil
	}
	for _, n := range slices.Clone(d.Nodes) {
		if n.Kind == "output" {
			if err := ensure(n.ID, "", n.ItemID, n.ParentID, map[string]string{}); err != nil {
				return d, err
			}
		}
		if n.Kind == "production" && !n.Surplus && (!n.Generated || manualSources[n.ID] || len(n.DisabledOutputs) > 0) {
			for _, a := range x.Recipes[n.RecipeID].Ingredients {
				if err := ensure(n.ID, "", a.ItemID, n.ParentID, map[string]string{n.ItemID: n.ID}); err != nil {
					return d, err
				}
			}
		}
	}
	for i := 0; i < len(d.Nodes); i++ {
		n := d.Nodes[i]
		if n.Kind == "input" && n.ParentID != "" {
			if err := ensure(n.ID, "", n.ItemID, nodeMap(d)[n.ParentID].ParentID, map[string]string{}); err != nil {
				return d, err
			}
		}
		if n.Kind == "link" {
			for _, child := range diagrams {
				if child.ID != n.LinkedDiagramID {
					continue
				}
				for _, input := range child.Document.Nodes {
					if input.Kind == "input" && input.ParentID == "" {
						if err := ensure(n.ID, input.ID, input.ItemID, n.ParentID, map[string]string{}); err != nil {
							return d, err
						}
					}
				}
			}
		}
	}

	pruneGenerated(&d)
	if err := expandSurplus(&d, x, oldSurplus, oldEdges, diagrams, ensure); err != nil {
		return d, err
	}
	for i := 0; i < len(d.Nodes); i++ {
		n := d.Nodes[i]
		if n.Kind == "input" && n.ParentID != "" {
			if err := ensure(n.ID, "", n.ItemID, nodeMap(d)[n.ParentID].ParentID, map[string]string{}); err != nil {
				return d, err
			}
		}
	}
	connectByproducts(&d, x, oldEdges)
	pruneGenerated(&d)
	fitGroups(&d)
	return d, Validate(d, catalog)
}

func fitGroups(d *Document) {
	var fit func(string)
	fit = func(id string) {
		for _, n := range slices.Clone(d.Nodes) {
			if n.ParentID == id && n.Kind == "group" {
				fit(n.ID)
			}
		}
		if id == "" {
			return
		}
		minX, minY, maxX, maxY := 0.0, 0.0, 300.0, 180.0
		for _, n := range d.Nodes {
			if n.ParentID == id {
				minX = math.Min(minX, n.X-40)
				minY = math.Min(minY, n.Y-65)
				maxX = math.Max(maxX, n.X+n.Width+40)
				maxY = math.Max(maxY, n.Y+n.Height+40)
			}
		}
		for i := range d.Nodes {
			n := &d.Nodes[i]
			if n.ParentID == id {
				n.X -= minX
				n.Y -= minY
			}
			if n.ID == id {
				n.X += minX
				n.Y += minY
				n.Width = math.Max(n.Width, maxX) - minX
				n.Height = math.Max(n.Height, maxY) - minY
			}
		}
	}
	fit("")
}

// ValidateWorkspace prevents cross-session or recursive factory imports.
func ValidateWorkspace(ds []Diagram) error {
	byID := map[string]Diagram{}
	for _, d := range ds {
		byID[d.ID] = d
	}
	visiting, done := map[string]bool{}, map[string]bool{}
	var visit func(string) error
	visit = func(id string) error {
		if visiting[id] {
			return fmt.Errorf("circular factory import at %s", byID[id].Document.Name)
		}
		if done[id] {
			return nil
		}
		visiting[id] = true
		for _, n := range byID[id].Document.Nodes {
			if n.Kind != "link" {
				continue
			}
			child, ok := byID[n.LinkedDiagramID]
			if !ok || child.SessionID != byID[id].SessionID {
				return fmt.Errorf("linked factory must exist in the same session")
			}
			if err := visit(child.ID); err != nil {
				return err
			}
		}
		delete(visiting, id)
		done[id] = true
		return nil
	}
	for _, d := range ds {
		if err := visit(d.ID); err != nil {
			return err
		}
	}
	return nil
}

// EqualDocument compares authored content without catalog stamps or nil-slice differences.
func EqualDocument(a, b Document) bool {
	normalize := func(d Document) Document {
		d.CatalogVersion = ""
		d.Settings.Recipes = append([]RecipeChoice{}, d.Settings.Recipes...)
		d.Nodes = append([]Node{}, d.Nodes...)
		d.Connections = append([]Connection{}, d.Connections...)
		for i := range d.Nodes {
			d.Nodes[i].Settings.Recipes = append([]RecipeChoice{}, d.Nodes[i].Settings.Recipes...)
		}
		return d
	}
	return reflect.DeepEqual(normalize(a), normalize(b))
}

func pruneGenerated(d *Document) {
	keep := map[string]bool{}
	var visit func(string)
	visit = func(id string) {
		if keep[id] {
			return
		}
		keep[id] = true
		for _, e := range d.Connections {
			if e.Target == id {
				visit(e.Source)
			}
		}
	}
	for _, n := range d.Nodes {
		if !n.Generated || len(n.DisabledOutputs) > 0 {
			visit(n.ID)
		}
	}
	for _, e := range d.Connections {
		if !e.Generated {
			visit(e.Source)
			visit(e.Target)
		}
	}
	d.Nodes = slices.DeleteFunc(slices.Clone(d.Nodes), func(n Node) bool { return !keep[n.ID] })
	d.Connections = slices.DeleteFunc(slices.Clone(d.Connections), func(e Connection) bool { return !keep[e.Source] || !keep[e.Target] })
}

func pruneIdleGenerated(d *Document, r Calculation) {
	demand := map[string]bool{}
	var visit func(string)
	visit = func(id string) {
		if demand[id] {
			return
		}
		demand[id] = true
		for _, e := range d.Connections {
			if e.Target == id {
				visit(e.Source)
			}
		}
	}
	for _, n := range d.Nodes {
		if n.Kind == "output" && n.OutputRateMode == "demand" {
			visit(n.ID)
		}
	}
	manual := map[string]bool{}
	for _, e := range d.Connections {
		if !e.Generated {
			manual[e.Source], manual[e.Target] = true, true
		}
	}
	idle := map[string]bool{}
	for _, n := range d.Nodes {
		if !n.Generated || len(n.DisabledOutputs) > 0 || manual[n.ID] || demand[n.ID] || (n.Kind != "production" && n.Kind != "input") {
			continue
		}
		for _, result := range r.Nodes {
			if result.NodeID != n.ID {
				continue
			}
			active := false
			for _, f := range result.Outputs {
				active = active || f.Rate > 1e-5
			}
			if !active {
				idle[n.ID] = true
			}
		}
	}
	d.Nodes = slices.DeleteFunc(slices.Clone(d.Nodes), func(n Node) bool { return idle[n.ID] })
	d.Connections = slices.DeleteFunc(slices.Clone(d.Connections), func(e Connection) bool { return idle[e.Source] || idle[e.Target] })
	pruneGenerated(d)
}
