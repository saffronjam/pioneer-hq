package planner

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"slices"
	"strings"
)

// Buildable identifies nodes that represent construction work.
func Buildable(n Node) bool {
	return n.Kind == "production" || n.Kind == "group" || n.Kind == "link"
}

func calculationDocument(d Document) Document {
	d.Name, d.Description, d.CatalogVersion = "", "", ""
	d.Viewport = Viewport{}
	d.Nodes = slices.Clone(d.Nodes)
	d.Connections = slices.Clone(d.Connections)
	for i := range d.Nodes {
		n := &d.Nodes[i]
		n.Name, n.Status, n.BuiltFingerprint = "", "", ""
		n.X, n.Y, n.Width, n.Height = 0, 0, 0, 0
		n.Collapsed, n.Generated = false, false
		if n.OutputRateMode == "" {
			n.OutputRateMode = "fixed"
		}
		if n.Kind == "output" && n.OutputRateMode == "demand" {
			n.Rate = 0
		}
		if n.Kind == "input" && n.InputRateMode != "fixed" {
			n.InputRateMode, n.Rate = "calculated", 0
		}
	}
	for i := range d.Connections {
		d.Connections[i].Generated = false
	}
	slices.SortFunc(d.Nodes, func(a, b Node) int { return strings.Compare(a.ID, b.ID) })
	slices.SortFunc(d.Connections, func(a, b Connection) int { return strings.Compare(a.ID, b.ID) })
	return d
}

func stampCalculationKeys(c Catalog, ds []Diagram) {
	adjacent := map[string][]string{}
	documents := map[string]Document{}
	for _, d := range ds {
		documents[d.ID] = calculationDocument(d.Document)
		for _, n := range d.Document.Nodes {
			if n.Kind == "link" {
				adjacent[d.ID] = append(adjacent[d.ID], n.LinkedDiagramID)
				adjacent[n.LinkedDiagramID] = append(adjacent[n.LinkedDiagramID], d.ID)
			}
		}
	}
	keys := map[string]string{}
	for i, d := range ds {
		if keys[d.ID] == "" {
			component := map[string]Document{}
			var visit func(string)
			visit = func(id string) {
				if _, ok := component[id]; ok {
					return
				}
				component[id] = documents[id]
				for _, next := range adjacent[id] {
					visit(next)
				}
			}
			visit(d.ID)
			data, _ := json.Marshal(struct {
				Catalog   string
				Documents map[string]Document
			}{c.Version, component})
			sum := sha256.Sum256(data)
			key := hex.EncodeToString(sum[:])
			for id := range component {
				keys[id] = key
			}
		}
		ds[i].CalculationKey = keys[d.ID]
	}
}
