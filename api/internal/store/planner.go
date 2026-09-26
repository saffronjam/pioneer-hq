package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"api/internal/planner"
	"api/internal/session"
	"api/internal/store/sqlite"
	"github.com/google/uuid"
)

func plannerRows(rows []sqlite.PlannerDiagram) ([]planner.Diagram, error) {
	ds := make([]planner.Diagram, 0, len(rows))
	for _, r := range rows {
		var doc planner.Document
		if err := json.Unmarshal([]byte(r.Document), &doc); err != nil {
			return nil, fmt.Errorf("decode diagram: %w", err)
		}
		updated, err := time.Parse("2006-01-02 15:04:05", r.UpdatedAt)
		if err != nil {
			return nil, err
		}
		ds = append(ds, planner.Diagram{ID: r.ID, SessionID: r.SessionID, Revision: int(r.Revision), UpdatedAt: updated, Document: doc})
	}
	return ds, nil
}

func loadPlanner(ctx context.Context, q *sqlite.Queries, sid string) (planner.Catalog, []planner.Diagram, error) {
	if _, err := q.GetSession(ctx, session.ID(sid)); err != nil {
		return planner.Catalog{}, nil, fmt.Errorf("session not found: %w", err)
	}
	c := planner.BundledCatalog()
	raw, err := q.GetPlannerCatalog(ctx, sid)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return c, nil, err
	}
	if err == nil {
		if err := json.Unmarshal([]byte(raw), &c); err != nil {
			return c, nil, err
		}
	}
	metadata := planner.BundledCatalog()
	recipeMetadata := make(map[string]planner.Recipe, len(metadata.Recipes))
	for _, recipe := range metadata.Recipes {
		recipeMetadata[recipe.ID] = recipe
	}
	for i := range c.Recipes {
		if recipe, ok := recipeMetadata[c.Recipes[i].ID]; ok {
			c.Recipes[i].Alternate = recipe.Alternate
		}
	}
	for i := range c.Machines {
		for _, machine := range metadata.Machines {
			if c.Machines[i].ID == machine.ID {
				c.Machines[i].BuildCost = machine.BuildCost
			}
		}
	}
	for _, item := range metadata.Items {
		if !slices.ContainsFunc(c.Items, func(i planner.Item) bool { return i.ID == item.ID }) {
			c.Items = append(c.Items, item)
		}
	}
	c.Version = planner.CatalogVersion(c)
	rows, err := q.ListPlannerDiagrams(ctx, sid)
	if err != nil {
		return c, nil, err
	}
	ds, err := plannerRows(rows)
	return c, ds, err
}

// LoadPlanner returns a consistent session snapshot, even while another client saves.
func (s *DB) LoadPlanner(ctx context.Context, sid string) (planner.Catalog, []planner.Diagram, error) {
	var c planner.Catalog
	var ds []planner.Diagram
	err := s.execTx(ctx, func(q *sqlite.Queries) error { var err error; c, ds, err = loadPlanner(ctx, q, sid); return err })
	return c, ds, err
}

// SavePlanner atomically validates ownership, dependency cycles, and the expected revision.
func (s *DB) SavePlanner(ctx context.Context, sid, id string, expected int, doc planner.Document) (planner.Diagram, error) {
	var saved planner.Diagram
	err := s.execTx(ctx, func(q *sqlite.Queries) error {
		c, ds, err := loadPlanner(ctx, q, sid)
		if err != nil {
			return err
		}
		if err := planner.Validate(doc, c); err != nil {
			return err
		}
		doc.CatalogVersion = c.Version
		create := id == ""
		if create {
			id = uuid.NewString()
			expected = 0
		}
		position := -1
		for i, d := range ds {
			if d.ID == id {
				position = i
				break
			}
		}
		if !create && (position < 0 || ds[position].Revision != expected) {
			return fmt.Errorf("CONFLICT: diagram changed or was deleted; reload before reapplying edits")
		}
		if !create {
			before := ds[position].Document
			before.CatalogVersion = doc.CatalogVersion
			if planner.EqualDocument(before, doc) {
				saved = ds[position]
				return nil
			}
		}
		saved = planner.Diagram{ID: id, SessionID: sid, Revision: expected + 1, Document: doc, UpdatedAt: time.Now().UTC()}
		if create {
			ds = append(ds, saved)
		} else {
			ds[position] = saved
		}
		if err := planner.ValidateWorkspace(ds); err != nil {
			return err
		}
		encoded, err := json.Marshal(doc)
		if err != nil {
			return err
		}
		if create {
			err = q.InsertPlannerDiagram(ctx, sqlite.InsertPlannerDiagramParams{ID: id, SessionID: sid, Document: string(encoded)})
		} else {
			var n int64
			n, err = q.UpdatePlannerDiagram(ctx, sqlite.UpdatePlannerDiagramParams{ID: id, SessionID: sid, Document: string(encoded), Revision: int64(expected)})
			if err == nil && n != 1 {
				return fmt.Errorf("CONFLICT: diagram revision changed")
			}
		}
		if err != nil {
			return err
		}
		if err := q.DeletePlannerDependencies(ctx, id); err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, n := range doc.Nodes {
			if n.Kind == "link" && !seen[n.LinkedDiagramID] {
				if err := q.InsertPlannerDependency(ctx, sqlite.InsertPlannerDependencyParams{DiagramID: id, TargetID: n.LinkedDiagramID, SessionID: sid}); err != nil {
					return err
				}
				seen[n.LinkedDiagramID] = true
			}
		}
		return nil
	})
	return saved, err
}

// DeletePlanner removes an unreferenced diagram at its expected revision.
func (s *DB) DeletePlanner(ctx context.Context, sid, id string, revision int) error {
	return s.execTx(ctx, func(q *sqlite.Queries) error {
		_, ds, err := loadPlanner(ctx, q, sid)
		if err != nil {
			return err
		}
		found := false
		for _, d := range ds {
			if d.ID == id {
				found = true
			}
		}
		if !found {
			return ErrNotFound
		}
		consumers, err := q.GetPlannerConsumers(ctx, id)
		if err != nil {
			return err
		}
		if len(consumers) > 0 {
			return fmt.Errorf("factory is referenced by diagrams %v; remove their links first", consumers)
		}
		n, err := q.DeletePlannerDiagram(ctx, sqlite.DeletePlannerDiagramParams{ID: id, SessionID: sid, Revision: int64(revision)})
		if err != nil {
			return err
		}
		if n != 1 {
			return fmt.Errorf("CONFLICT: diagram changed before deletion")
		}
		return nil
	})
}

// SavePlannerCatalog caches a validated session-specific catalog.
func (s *DB) SavePlannerCatalog(ctx context.Context, sid string, c planner.Catalog) error {
	if _, err := planner.NewIndex(c); err != nil {
		return err
	}
	data, err := json.Marshal(c)
	if err != nil {
		return err
	}
	return s.execTx(ctx, func(q *sqlite.Queries) error {
		if _, err := q.GetSession(ctx, session.ID(sid)); err != nil {
			return err
		}
		return q.SavePlannerCatalog(ctx, sqlite.SavePlannerCatalogParams{SessionID: sid, Catalog: string(data)})
	})
}
