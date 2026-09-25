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
		settings = append(settings, n.Settings)
	}
	for _, s := range settings {
		if s.BeltTier < 0 || s.BeltTier > len(catalog.Belts) || s.PipeTier < 0 || s.PipeTier > len(catalog.Pipes) {
			return fmt.Errorf("invalid belt or pipe tier")
		}
		seen := map[string]bool{}
		for _, choice := range s.Recipes {
			_, ok := x.Recipes[choice.RecipeID]
			if !ok || seen[choice.ItemID] {
				return fmt.Errorf("invalid recipe choice for %s", choice.ItemID)
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
	choices := map[string]string{}
	for _, s := range chain {
		if s.BeltTier > 0 {
			out.BeltTier = s.BeltTier
		}
		if s.PipeTier > 0 {
			out.PipeTier = s.PipeTier
		}
		for _, r := range s.Recipes {
			choices[r.ItemID] = r.RecipeID
		}
	}
	keys := make([]string, 0, len(choices))
	for k := range choices {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, k := range keys {
		out.Recipes = append(out.Recipes, RecipeChoice{k, choices[k]})
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
	for _, r := range x.Producing[item] {
		if !r.Alternate && !strings.HasPrefix(r.ID, "Recipe_Unpackage") && r.Products[0].ItemID == item {
			candidates = append(candidates, r)
		}
	}
	if len(candidates) == 1 {
		return candidates[0], true
	}
	return Recipe{}, false
}

// Expand fills unconnected target and production inputs within their own scope.
func Expand(d Document, catalog Catalog) (Document, error) {
	if err := Validate(d, catalog); err != nil {
		return d, err
	}
	x, _ := NewIndex(catalog)
	converted := map[string]bool{}
	for i := range d.Nodes {
		n := &d.Nodes[i]
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
			} else if !ok && n.Kind == "production" {
				n.Kind = "input"
				n.RecipeID = ""
				n.MachineID = ""
				n.Somersloops = 0
				converted[n.ID] = true
			}
		}
	}
	nodes := nodeMap(d)
	d.Connections = slices.DeleteFunc(d.Connections, func(e Connection) bool {
		s, t := nodes[e.Source], nodes[e.Target]
		return converted[e.Target] || (s.Kind == "production" && !hasAmount(x.Recipes[s.RecipeID].Products, e.ItemID)) || (t.Kind == "production" && !hasAmount(x.Recipes[t.RecipeID].Ingredients, e.ItemID))
	})
	var ensure func(string, string, map[string]string) error
	ensure = func(target, item string, ancestors map[string]string) error {
		for _, e := range d.Connections {
			if e.Target == target && e.ItemID == item {
				return nil
			}
		}
		t := nodeMap(d)[target]
		provider := ""
		for _, n := range d.Nodes {
			if n.ParentID == t.ParentID && n.ItemID == item && n.ID != target && slices.Contains([]string{"supply", "input", "production"}, n.Kind) {
				provider = n.ID
				break
			}
		}
		if provider == "" {
			provider = ancestors[item]
		}
		if provider == "" {
			if len(d.Nodes) >= 1000 {
				return fmt.Errorf("expanded diagram exceeds 1000 nodes")
			}
			n := Node{ID: uuid.NewString(), Generated: true, Kind: "input", ParentID: t.ParentID, Name: x.Items[item].Name, ItemID: item, X: t.X - 310, Y: t.Y + float64(len(d.Nodes)%4)*45, Width: 240, Height: 140, Clock: 100, Status: "planned", Settings: Settings{Recipes: []RecipeChoice{}}}
			if r, ok := chooseRecipe(d, t.ParentID, item, x); ok {
				n.Kind = "production"
				n.RecipeID = r.ID
				n.MachineID = r.MachineIDs[0]
			}
			d.Nodes = append(d.Nodes, n)
			provider = n.ID
		}
		d.Connections = append(d.Connections, Connection{ID: uuid.NewString(), Source: provider, Target: target, ItemID: item})
		n := nodeMap(d)[provider]
		if n.Kind == "production" {
			next := map[string]string{}
			for k, v := range ancestors {
				next[k] = v
			}
			next[item] = provider
			for _, a := range x.Recipes[n.RecipeID].Ingredients {
				if err := ensure(provider, a.ItemID, next); err != nil {
					return err
				}
			}
		}
		return nil
	}
	original := slices.Clone(d.Nodes)
	for _, n := range original {
		if n.Kind == "output" {
			if err := ensure(n.ID, n.ItemID, map[string]string{}); err != nil {
				return d, err
			}
		}
		if n.Kind == "production" {
			for _, a := range x.Recipes[n.RecipeID].Ingredients {
				if err := ensure(n.ID, a.ItemID, map[string]string{n.ItemID: n.ID}); err != nil {
					return d, err
				}
			}
		}
	}
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
