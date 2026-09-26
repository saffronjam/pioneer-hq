package planner

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strings"
)

type equation struct {
	coefficients map[int]float64
	rhs          float64
}

const (
	targetObjective = iota
	connectionObjective
	supplyObjective
	surplusProductionObjective
	surplusUseObjective
	externalInputObjective
	activityObjective
	objectiveCount
)

type program struct {
	rows  []equation
	costs [objectiveCount][]float64
}

func (p *program) variable(stage int, cost float64) int {
	i := len(p.costs[0])
	for s := range p.costs {
		v := 0.0
		if s == stage {
			v = cost
		}
		p.costs[s] = append(p.costs[s], v)
	}
	return i
}
func (p *program) eq(coeff map[int]float64, rhs float64) {
	p.rows = append(p.rows, equation{coeff, rhs})
}
func (p *program) le(coeff map[int]float64, rhs float64) {
	coeff[p.variable(activityObjective, 0)] = 1
	p.eq(coeff, rhs)
}
func cloneCoefficients(m map[int]float64) map[int]float64 {
	n := map[int]float64{}
	for k, v := range m {
		n[k] = v
	}
	return n
}

type port struct {
	node string
	item string
}
type compiledNode struct {
	diagram  string
	node     Node
	activity int
	recipe   Recipe
	machine  Machine
}
type deficit struct {
	variable                           int
	diagram, node, item, code, message string
}
type surplus struct {
	variable            int
	diagram, node, item string
}

func calculateComponent(ctx context.Context, catalog Catalog, ds []Diagram, revision string) ([]Calculation, error) {
	x, err := NewIndex(catalog)
	if err != nil {
		return nil, err
	}
	if err := ValidateWorkspace(ds); err != nil {
		return nil, err
	}
	p := &program{}
	hasSurplus := false
	for _, d := range ds {
		for _, n := range d.Document.Nodes {
			hasSurplus = hasSurplus || n.Surplus
		}
	}
	nodes := map[string]compiledNode{}
	byDiagram := map[string]Diagram{}
	results := make([]Calculation, len(ds))
	resultIndex := map[string]int{}
	for i, d := range ds {
		if err := Validate(d.Document, catalog); err != nil {
			return nil, err
		}
		byDiagram[d.ID] = d
		resultIndex[d.ID] = i
		results[i] = Calculation{Resolved: true, DiagramID: d.ID, Revision: d.Revision, CatalogVersion: catalog.Version, WorkspaceRevision: revision, Nodes: []NodeResult{}, Connections: []ConnectionResult{}, Diagnostics: []Diagnostic{}}
		for _, n := range d.Document.Nodes {
			cn := compiledNode{diagram: d.ID, node: n, activity: -1}
			if n.Kind == "production" {
				cn.recipe = x.Recipes[n.RecipeID]
				cn.machine = x.Machines[n.MachineID]
				cn.activity = p.variable(activityObjective, 1)
			}
			nodes[d.ID+"/"+n.ID] = cn
		}
	}
	incoming, outgoing := map[port]map[int]float64{}, map[port]map[int]float64{}
	edgeVars := map[string]int{}
	var surplusFeeds []surplusFeed
	addDiagnostic := func(d Diagnostic) {
		i := resultIndex[d.DiagramID]
		results[i].Diagnostics = append(results[i].Diagnostics, d)
	}
	edgeValue := func(did, eid string, value func(int) float64) float64 {
		if v, ok := edgeVars[did+"/"+eid]; ok {
			return value(v)
		}
		return 0
	}
	resolve := func(d Diagram, id, item, portID string, source bool) (string, error) {
		n := nodes[d.ID+"/"+id].node
		if n.Kind != "link" {
			return d.ID + "/" + id, nil
		}
		child := byDiagram[n.LinkedDiagramID]
		kind := "input"
		if source {
			kind = "output"
		}
		var matches []string
		for _, cn := range child.Document.Nodes {
			if cn.Kind == kind && (kind != "output" || cn.Exposed) && cn.ItemID == item && (portID == "" || cn.ID == portID) {
				matches = append(matches, child.ID+"/"+cn.ID)
			}
		}
		if len(matches) != 1 {
			return "", fmt.Errorf("link %s: select an existing %s port for %s", n.Name, kind, item)
		}
		return matches[0], nil
	}
	for _, d := range ds {
		for _, e := range d.Document.Connections {
			s, err := resolve(d, e.Source, e.ItemID, e.SourcePort, true)
			if err != nil {
				addDiagnostic(Diagnostic{DiagramID: d.ID, ConnectionID: e.ID, Code: "invalid_port", Message: err.Error()})
				continue
			}
			t, err := resolve(d, e.Target, e.ItemID, e.TargetPort, false)
			if err != nil {
				addDiagnostic(Diagnostic{DiagramID: d.ID, ConnectionID: e.ID, Code: "invalid_port", Message: err.Error()})
				continue
			}
			sn, tn := nodes[s], nodes[t]
			if sn.node.Kind == "production" {
				if !hasAmount(sn.recipe.Products, e.ItemID) {
					return nil, fmt.Errorf("invalid output material on connection %s", e.ID)
				}
			} else if sn.node.ItemID != e.ItemID || !slices.Contains([]string{"input", "supply", "output"}, sn.node.Kind) {
				return nil, fmt.Errorf("invalid source on connection %s", e.ID)
			}
			if tn.node.Kind == "production" {
				if !hasAmount(tn.recipe.Ingredients, e.ItemID) {
					return nil, fmt.Errorf("invalid ingredient on connection %s", e.ID)
				}
			} else if tn.node.ItemID != e.ItemID || !slices.Contains([]string{"input", "output"}, tn.node.Kind) {
				return nil, fmt.Errorf("invalid target on connection %s", e.ID)
			}
			v := p.variable(activityObjective, 1e-6)
			edgeVars[d.ID+"/"+e.ID] = v
			sp, tp := port{s, e.ItemID}, port{t, e.ItemID}
			if outgoing[sp] == nil {
				outgoing[sp] = map[int]float64{}
			}
			if incoming[tp] == nil {
				incoming[tp] = map[int]float64{}
			}
			if tn.node.Surplus {
				surplusFeeds = append(surplusFeeds, surplusFeed{s, t, e.ItemID, v})
			}
			outgoing[sp][v] = 1
			incoming[tp][v] = 1
		}
	}
	var deficits []deficit
	var surpluses []surplus
	addDeficit := func(row map[int]float64, coefficient float64, stage int, cn compiledNode, item, code, message string) {
		v := p.variable(stage, 1)
		row[v] = coefficient
		deficits = append(deficits, deficit{v, cn.diagram, cn.node.ID, item, code, message})
	}
	keys := make([]string, 0, len(nodes))
	for k := range nodes {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, key := range keys {
		cn := nodes[key]
		n := cn.node
		switch n.Kind {
		case "production":
			clock := n.Clock / 100
			boost := 1 + float64(n.Somersloops)*cn.machine.BoostPerSlot
			for _, a := range cn.recipe.Ingredients {
				row := cloneCoefficients(incoming[port{key, a.ItemID}])
				row[cn.activity] = -a.Amount * 60 / cn.recipe.Duration * clock
				addDeficit(row, 1, connectionObjective, cn, a.ItemID, "unconnected", "Production input is not fully connected")
				p.eq(row, 0)
			}
			for _, a := range cn.recipe.Products {
				if outputDisabled(n, a.ItemID) {
					continue
				}
				row := cloneCoefficients(outgoing[port{key, a.ItemID}])
				row[cn.activity] = -a.Amount * 60 / cn.recipe.Duration * clock * boost
				v := p.variable(activityObjective, 0)
				row[v] = 1
				p.eq(row, 0)
				surpluses = append(surpluses, surplus{v, cn.diagram, n.ID, a.ItemID})
			}
		case "supply":
			row := cloneCoefficients(outgoing[port{key, n.ItemID}])
			addDeficit(row, -1, supplyObjective, cn, n.ItemID, "supply_shortage", "Supply is below the planned requirement")
			if n.FixedSupply {
				v := p.variable(activityObjective, 0)
				row[v] = 1
				p.eq(row, n.Rate)
				surpluses = append(surpluses, surplus{v, cn.diagram, n.ID, n.ItemID})
			} else {
				p.le(row, n.Rate)
			}
		case "input":
			stage := supplyObjective
			if hasSurplus {
				stage = externalInputObjective
			}
			if len(incoming[port{key, n.ItemID}]) > 0 {
				stage = connectionObjective
			}
			if n.InputRateMode == "fixed" {
				row := cloneCoefficients(incoming[port{key, n.ItemID}])
				addDeficit(row, 1, stage, cn, n.ItemID, "input_shortage", "Provide this material from a source or parent factory")
				p.eq(row, n.Rate)
				row = cloneCoefficients(outgoing[port{key, n.ItemID}])
				addDeficit(row, -1, supplyObjective, cn, n.ItemID, "required_input_shortage", "Required input rate is below downstream demand")
				v := p.variable(activityObjective, 0)
				row[v] = 1
				p.eq(row, n.Rate)
				surpluses = append(surpluses, surplus{v, cn.diagram, n.ID, n.ItemID})
			} else {
				row := cloneCoefficients(outgoing[port{key, n.ItemID}])
				for v, c := range incoming[port{key, n.ItemID}] {
					row[v] -= c
				}
				addDeficit(row, -1, stage, cn, n.ItemID, "input_shortage", "Provide this material from a source or parent factory")
				p.eq(row, 0)
			}

		case "output":
			row := cloneCoefficients(incoming[port{key, n.ItemID}])
			addDeficit(row, 1, targetObjective, cn, n.ItemID, "output_shortage", "Output target is not fully connected")
			if n.OutputRateMode == "demand" {
				for v, c := range outgoing[port{key, n.ItemID}] {
					row[v] -= c
				}
				p.eq(row, 0)
			} else {
				p.eq(row, n.Rate)
				if n.Exposed {
					row = cloneCoefficients(outgoing[port{key, n.ItemID}])
					addDeficit(row, -1, supplyObjective, cn, n.ItemID, "overallocated", "Export demand exceeds the fixed output")
					p.le(row, n.Rate)
				}
			}
		}
	}
	values, err := p.solveSurplus(ctx, nodes, surpluses, surplusFeeds, outgoing)
	if err != nil {
		return nil, err
	}
	value := func(i int) float64 {
		if i < 0 || i >= len(values) {
			return 0
		}
		v := math.Max(0, values[i])
		if v < 1e-6 {
			return 0
		}
		return v
	}
	for _, f := range deficits {
		if f.code == "input_shortage" && len(incoming[port{f.diagram + "/" + f.node, f.item}]) == 0 {
			continue
		}
		if v := value(f.variable); v > 1e-5 {
			addDiagnostic(Diagnostic{DiagramID: f.diagram, NodeID: f.node, ItemID: f.item, Rate: v, Code: f.code, Message: f.message})
		}
	}
	for _, s := range surpluses {
		if v := value(s.variable); v > 1e-5 {
			addDiagnostic(Diagnostic{DiagramID: s.diagram, NodeID: s.node, ItemID: s.item, Rate: v, Code: "surplus", Message: "Surplus needs an output or disposal destination"})
		}
	}
	for _, d := range ds {
		result := &results[resultIndex[d.ID]]
		for _, n := range d.Document.Nodes {
			cn := nodes[d.ID+"/"+n.ID]
			r := NodeResult{NodeID: n.ID, Inputs: []Flow{}, Outputs: []Flow{}}
			if n.Kind == "production" {
				r.EquivalentMachines = value(cn.activity)
				r.Machines = int(math.Ceil(r.EquivalentMachines - 1e-7))
				if r.Machines > 0 {
					r.Utilization = r.EquivalentMachines / float64(r.Machines)
				}
				r.Somersloops = r.Machines * n.Somersloops
				clock := n.Clock / 100
				boost := 1 + float64(n.Somersloops)*cn.machine.BoostPerSlot
				for _, a := range cn.recipe.Ingredients {
					r.Inputs = append(r.Inputs, Flow{a.ItemID, a.Amount * 60 / cn.recipe.Duration * clock * r.EquivalentMachines})
				}
				for _, a := range cn.recipe.Products {
					if outputDisabled(n, a.ItemID) {
						continue
					}
					r.Outputs = append(r.Outputs, Flow{a.ItemID, a.Amount * 60 / cn.recipe.Duration * clock * boost * r.EquivalentMachines})
				}
				lo, hi := cn.machine.Power, cn.machine.Power
				if cn.machine.VariablePower {
					lo += cn.recipe.PowerConstant
					hi += cn.recipe.PowerConstant + cn.recipe.PowerFactor
				}
				factor := math.Pow(clock, cn.machine.PowerExponent) * math.Pow(boost, cn.machine.BoostPowerExponent)
				r.PowerKnown = true
				r.PowerMin = lo * factor * r.EquivalentMachines
				r.PowerMax = hi * factor * r.EquivalentMachines
				r.InstalledPowerMax = hi * factor * float64(r.Machines)
			} else {
				for _, e := range d.Document.Connections {
					rate := edgeValue(d.ID, e.ID, value)
					if e.Target == n.ID {
						r.Inputs = appendFlow(r.Inputs, e.ItemID, rate)
					}
					if e.Source == n.ID {
						r.Outputs = appendFlow(r.Outputs, e.ItemID, rate)
					}
				}
				if n.Kind == "output" {
					produced := 0.0
					for v := range incoming[port{d.ID + "/" + n.ID, n.ItemID}] {
						produced += value(v)
					}
					for v := range outgoing[port{d.ID + "/" + n.ID, n.ItemID}] {
						r.ExportRate += value(v)
					}
					r.Outputs = []Flow{{n.ItemID, produced}}
					if n.Exposed {
						r.SurplusRate = math.Max(0, produced-r.ExportRate)
					}
				}
			}
			if n.Kind == "input" {
				r.Inputs = []Flow{}
				for v := range incoming[port{d.ID + "/" + n.ID, n.ItemID}] {
					r.Inputs = appendFlow(r.Inputs, n.ItemID, value(v))
				}
			}
			result.Nodes = append(result.Nodes, r)
		}
		for _, e := range d.Document.Connections {
			scope := ConnectionScope(d.Document, e.Source, e.Target)
			settings := EffectiveSettings(d.Document, scope)
			tier := settings.BeltTier
			capacities := catalog.Belts
			if x.Items[e.ItemID].Form != "solid" {
				tier = settings.PipeTier
				capacities = catalog.Pipes
			}
			rate := edgeValue(d.ID, e.ID, value)
			capacity := capacities[tier-1]
			required := int(math.Ceil(rate/capacity - 1e-7))
			result.Connections = append(result.Connections, ConnectionResult{e.ID, rate, tier, capacity, required, scope})
			if e.AvailableLines != nil && rate > float64(*e.AvailableLines)*capacity+1e-5 {
				addDiagnostic(Diagnostic{DiagramID: d.ID, ConnectionID: e.ID, ItemID: e.ItemID, Code: "transport_shortage", Rate: rate - float64(*e.AvailableLines)*capacity, Message: "Configured transport capacity is insufficient"})
			}
		}
	}
	for _, d := range ds {
		nm := nodeMap(d.Document)
		result := &results[resultIndex[d.ID]]
		index := map[string]int{}
		for i, r := range result.Nodes {
			index[r.NodeID] = i
		}
		var aggregate func(string) string
		aggregate = func(id string) string {
			n := nm[id]
			r := &result.Nodes[index[id]]
			children := []string{}
			if n.Kind == "group" {
				r.PowerKnown = true
				inside := map[string]bool{}
				for _, child := range d.Document.Nodes {
					for p := child.ParentID; p != ""; p = nm[p].ParentID {
						if p == id {
							inside[child.ID] = true
							break
						}
					}
				}
				for _, child := range d.Document.Nodes {
					if child.ParentID == id {
						children = append(children, aggregate(child.ID))
						cr := result.Nodes[index[child.ID]]
						if child.Kind != "link" {
							r.Machines += cr.Machines
							r.Somersloops += cr.Somersloops
							r.PowerMin += cr.PowerMin
							r.PowerMax += cr.PowerMax
							r.InstalledPowerMax += cr.InstalledPowerMax
							if child.Kind == "group" && !cr.PowerKnown {
								r.PowerKnown = false
							}
						}
					}
				}
				for _, e := range d.Document.Connections {
					rate := edgeValue(d.ID, e.ID, value)
					if inside[e.Target] && !inside[e.Source] && nm[e.Target].Kind != "input" {
						r.Inputs = appendFlow(r.Inputs, e.ItemID, rate)
					}
					if inside[e.Source] && !inside[e.Target] && nm[e.Source].Kind != "output" {
						r.Outputs = appendFlow(r.Outputs, e.ItemID, rate)
					}
				}
				for _, child := range d.Document.Nodes {
					if !inside[child.ID] {
						continue
					}
					if child.Kind == "input" {
						required := 0.0
						for _, f := range result.Nodes[index[child.ID]].Outputs {
							required += f.Rate
						}
						if child.InputRateMode == "fixed" {
							required = child.Rate
						}
						for _, e := range d.Document.Connections {
							if e.Target == child.ID && inside[e.Source] {
								required -= edgeValue(d.ID, e.ID, value)
							}
						}
						r.Inputs = appendFlow(r.Inputs, child.ItemID, math.Max(0, required))
					}
					if child.Kind == "output" && child.Exposed {
						available := 0.0
						for _, f := range result.Nodes[index[child.ID]].Outputs {
							available += f.Rate
						}
						for _, e := range d.Document.Connections {
							if e.Source == child.ID && inside[e.Target] {
								available -= edgeValue(d.ID, e.ID, value)
							}
						}
						r.Outputs = appendFlow(r.Outputs, child.ItemID, math.Max(0, available))
					}
				}
			}
			r.Fingerprint = fingerprint(n, *r)
			for _, e := range d.Document.Connections {
				if e.Source == id || e.Target == id {
					settings := EffectiveSettings(d.Document, ConnectionScope(d.Document, e.Source, e.Target))
					b, _ := json.Marshal(struct {
						Source, Target, SourcePort, TargetPort, Item string
						Lines                                        *int
						Belt, Pipe                                   int
					}{e.Source, e.Target, e.SourcePort, e.TargetPort, e.ItemID, e.AvailableLines, settings.BeltTier, settings.PipeTier})
					children = append(children, string(b))
				}
			}
			if n.Kind == "link" {
				children = append(children, dependencyFingerprint(n.LinkedDiagramID, byDiagram, map[string]bool{}))
			}
			if len(children) > 0 {
				slices.Sort(children)
				b, _ := json.Marshal(append(children, r.Fingerprint))
				sum := sha256.Sum256(b)
				r.Fingerprint = hex.EncodeToString(sum[:])
			}
			if Buildable(n) && n.Status == "built" && n.BuiltFingerprint != "" && n.BuiltFingerprint != r.Fingerprint {
				addDiagnostic(Diagnostic{DiagramID: d.ID, NodeID: id, Code: "built_changed", Message: "Plan changed since marked built"})
			}
			return r.Fingerprint
		}
		for _, n := range d.Document.Nodes {
			if n.ParentID == "" {
				aggregate(n.ID)
			}
		}
	}
	for pass := 0; pass < len(ds); pass++ {
		changed := false
		for _, d := range ds {
			for _, n := range d.Document.Nodes {
				if n.Kind != "link" {
					continue
				}
				child := results[resultIndex[n.LinkedDiagramID]]
				if len(child.Diagnostics) == 0 {
					continue
				}
				exists := false
				for _, diag := range results[resultIndex[d.ID]].Diagnostics {
					if diag.NodeID == n.ID && diag.Code == "linked_warning" {
						exists = true
					}
				}
				if !exists {
					addDiagnostic(Diagnostic{DiagramID: d.ID, NodeID: n.ID, Code: "linked_warning", Message: "Linked factory has unresolved production warnings"})
					changed = true
				}
			}
		}
		if !changed {
			break
		}
	}
	return results, nil
}

func appendFlow(fs []Flow, item string, rate float64) []Flow {
	for i := range fs {
		if fs[i].ItemID == item {
			fs[i].Rate += rate
			return fs
		}
	}
	return append(fs, Flow{item, rate})
}

func dependencyFingerprint(id string, diagrams map[string]Diagram, seen map[string]bool) string {
	if seen[id] {
		return id
	}
	seen[id] = true
	d := diagrams[id].Document
	parts := []string{}
	for _, n := range d.Nodes {
		parts = append(parts, fingerprint(n, NodeResult{}))
		if n.Kind == "link" {
			parts = append(parts, dependencyFingerprint(n.LinkedDiagramID, diagrams, seen))
		}
	}
	for _, e := range d.Connections {
		b, _ := json.Marshal(e)
		parts = append(parts, string(b))
	}
	slices.Sort(parts)
	b, _ := json.Marshal(parts)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
func fingerprint(n Node, r NodeResult) string {
	r.Fingerprint = ""
	r.Inputs = slices.Clone(r.Inputs)
	r.Outputs = slices.Clone(r.Outputs)
	for _, flows := range [][]Flow{r.Inputs, r.Outputs} {
		slices.SortFunc(flows, func(a, b Flow) int { return strings.Compare(a.ItemID, b.ItemID) })
		for i := range flows {
			flows[i].Rate = math.Round(flows[i].Rate*1e4) / 1e4
		}
	}
	r.EquivalentMachines = math.Round(r.EquivalentMachines*1e4) / 1e4
	r.Utilization = math.Round(r.Utilization*1e4) / 1e4
	r.PowerMin = math.Round(r.PowerMin*1e4) / 1e4
	r.PowerMax = math.Round(r.PowerMax*1e4) / 1e4
	r.InstalledPowerMax = math.Round(r.InstalledPowerMax*1e4) / 1e4
	n.ParentID = ""
	n.Generated = false
	n.Settings = Settings{}
	n.X = 0
	n.Y = 0
	n.Width = 0
	n.Height = 0
	n.Collapsed = false
	n.Name = ""
	n.Status = ""
	n.BuiltFingerprint = ""
	b, _ := json.Marshal(struct {
		Node   Node
		Result NodeResult
	}{n, r})
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
