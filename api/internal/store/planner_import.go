package store

import (
	"context"
	"encoding/json"
	"fmt"

	"api/internal/planner"
	"api/internal/store/sqlite"
)

// ImportPlanner commits a complete linked factory graph in one transaction.
func (s *DB) ImportPlanner(ctx context.Context, sid string, imported []planner.Diagram) error {
	return s.execTx(ctx, func(q *sqlite.Queries) error {
		catalog, existing, err := loadPlanner(ctx, q, sid)
		if err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, d := range existing {
			seen[d.ID] = true
		}
		for _, d := range imported {
			if d.ID == "" || d.SessionID != sid || seen[d.ID] {
				return fmt.Errorf("invalid imported factory identity")
			}
			seen[d.ID] = true
			if err := planner.Validate(d.Document, catalog); err != nil {
				return err
			}
		}
		if err := planner.ValidateWorkspace(append(existing, imported...)); err != nil {
			return err
		}
		for _, d := range imported {
			d.Document.CatalogVersion = catalog.Version
			data, err := json.Marshal(d.Document)
			if err != nil {
				return err
			}
			if err := q.InsertPlannerDiagram(ctx, sqlite.InsertPlannerDiagramParams{ID: d.ID, SessionID: sid, Document: string(data)}); err != nil {
				return err
			}
		}
		for _, d := range imported {
			linked := map[string]bool{}
			for _, node := range d.Document.Nodes {
				if node.Kind != "link" || linked[node.LinkedDiagramID] {
					continue
				}
				linked[node.LinkedDiagramID] = true
				if err := q.InsertPlannerDependency(ctx, sqlite.InsertPlannerDependencyParams{DiagramID: d.ID, TargetID: node.LinkedDiagramID, SessionID: sid}); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
