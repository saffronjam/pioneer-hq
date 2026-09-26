package planner

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"strings"

	"github.com/google/uuid"
)

type planFile struct {
	Format   string        `json:"format"`
	Version  int           `json:"version"`
	RootID   string        `json:"rootId"`
	Diagrams []planDiagram `json:"diagrams"`
}

type planDiagram struct {
	ID       string   `json:"id"`
	Document Document `json:"document"`
}

// ParsePlan validates a portable plan and its complete linked factory graph.
func ParsePlan(data string, catalog Catalog) ([]Diagram, string, error) {
	if len(data) > 10*1024*1024 {
		return nil, "", fmt.Errorf("plan file exceeds 10 MB")
	}
	var file planFile
	decoder := json.NewDecoder(strings.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&file); err != nil {
		return nil, "", fmt.Errorf("invalid plan JSON: %w", err)
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, "", fmt.Errorf("plan file must contain one JSON object")
	}
	if file.Format != "pioneer-hq-plan" || file.Version != 1 {
		return nil, "", fmt.Errorf("unsupported plan file format")
	}
	if len(file.Diagrams) == 0 || len(file.Diagrams) > 100 {
		return nil, "", fmt.Errorf("plan file must contain between 1 and 100 factories")
	}
	diagrams := make([]Diagram, 0, len(file.Diagrams))
	seen := map[string]bool{}
	for _, d := range file.Diagrams {
		if d.ID == "" || seen[d.ID] {
			return nil, "", fmt.Errorf("plan file has missing or duplicate factory IDs")
		}
		seen[d.ID] = true
		if err := Validate(d.Document, catalog); err != nil {
			return nil, "", fmt.Errorf("invalid factory %q: %w", d.Document.Name, err)
		}
		diagrams = append(diagrams, Diagram{ID: d.ID, Document: d.Document})
	}
	if !seen[file.RootID] {
		return nil, "", fmt.Errorf("plan file has no root factory")
	}
	if err := ValidateWorkspace(diagrams); err != nil {
		return nil, "", err
	}
	reachable := linkedPlans(diagrams, file.RootID)
	if len(reachable) != len(diagrams) {
		return nil, "", fmt.Errorf("plan file contains unrelated factories")
	}
	return diagrams, file.RootID, nil
}

func linkedPlans(diagrams []Diagram, root string) []planDiagram {
	byID := map[string]Diagram{}
	for _, diagram := range diagrams {
		byID[diagram.ID] = diagram
	}
	seen := map[string]bool{}
	result := []planDiagram{}
	var visit func(string)
	visit = func(id string) {
		if seen[id] {
			return
		}
		seen[id] = true
		d := byID[id]
		result = append(result, planDiagram{ID: id, Document: d.Document})
		for _, node := range d.Document.Nodes {
			if node.Kind == "link" {
				visit(node.LinkedDiagramID)
			}
		}
	}
	visit(root)
	return result
}

// Export serializes a plan together with each linked factory once.
func (s *Service) Export(ctx context.Context, sid, id string) (string, error) {
	_, diagrams, err := s.store.LoadPlanner(ctx, sid)
	if err != nil {
		return "", err
	}
	if !slices.ContainsFunc(diagrams, func(d Diagram) bool { return d.ID == id }) {
		return "", fmt.Errorf("plan not found")
	}
	if err := ValidateWorkspace(diagrams); err != nil {
		return "", err
	}
	data, err := json.MarshalIndent(planFile{Format: "pioneer-hq-plan", Version: 1, RootID: id, Diagrams: linkedPlans(diagrams, id)}, "", "  ")
	return string(data), err
}

// ValidateImport checks a file against the session catalog without saving it.
func (s *Service) ValidateImport(ctx context.Context, sid, data string) ([]Diagram, string, error) {
	catalog, _, err := s.store.LoadPlanner(ctx, sid)
	if err != nil {
		return nil, "", err
	}
	return ParsePlan(data, catalog)
}

// Import creates independent copies of all factories in a validated plan file atomically.
func (s *Service) Import(ctx context.Context, sid, name, data string) (*Diagram, error) {
	catalog, _, err := s.store.LoadPlanner(ctx, sid)
	if err != nil {
		return nil, err
	}
	diagrams, root, err := ParsePlan(data, catalog)
	if err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 200 {
		return nil, fmt.Errorf("plan name must contain 1 to 200 characters")
	}
	ids := map[string]string{}
	for _, d := range diagrams {
		ids[d.ID] = uuid.NewString()
	}
	needsFingerprint := false
	for i := range diagrams {
		d := &diagrams[i]
		if d.ID == root {
			d.Document.Name = name
		}
		d.ID, d.SessionID, d.Revision = ids[d.ID], sid, 1
		d.Document.CatalogVersion = catalog.Version
		for j := range d.Document.Nodes {
			n := &d.Document.Nodes[j]
			if n.Kind == "link" {
				n.LinkedDiagramID = ids[n.LinkedDiagramID]
			}
			n.BuiltFingerprint = ""
			needsFingerprint = needsFingerprint || (Buildable(*n) && n.Status == "built")
		}
	}
	if needsFingerprint {
		select {
		case s.calculations <- struct{}{}:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		results, calcErr := Calculate(ctx, catalog, diagrams, "")
		<-s.calculations
		if calcErr != nil {
			return nil, calcErr
		}
		for _, result := range results {
			for i := range diagrams {
				if diagrams[i].ID != result.DiagramID {
					continue
				}
				for j := range diagrams[i].Document.Nodes {
					n := &diagrams[i].Document.Nodes[j]
					for _, nr := range result.Nodes {
						if n.ID == nr.NodeID && Buildable(*n) && n.Status == "built" {
							n.BuiltFingerprint = nr.Fingerprint
						}
					}
				}
			}
		}
	}
	if err := s.store.ImportPlanner(ctx, sid, diagrams); err != nil {
		return nil, err
	}
	s.changed(sid)
	workspace, err := s.Load(ctx, sid, false)
	if err != nil {
		return nil, err
	}
	for _, d := range workspace.Diagrams {
		if d.ID == ids[root] {
			return &d, nil
		}
	}
	return nil, fmt.Errorf("imported plan not found")
}

// Duplicate creates an independent named copy, including linked factories.
func (s *Service) Duplicate(ctx context.Context, sid, id, name string) (*Diagram, error) {
	data, err := s.Export(ctx, sid, id)
	if err != nil {
		return nil, err
	}
	return s.Import(ctx, sid, name, data)
}
