package planner

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"slices"
)

// MergeCatalog retains unavailable definitions so authored plans remain readable.
func MergeCatalog(previous, incoming Catalog) Catalog {
	next := incoming
	next.SyncError = ""
	recipes := map[string]Recipe{}
	for _, r := range incoming.Recipes {
		recipes[r.ID] = r
	}
	for _, r := range previous.Recipes {
		if _, ok := recipes[r.ID]; !ok {
			r.MissingCount = min(r.MissingCount+1, 2)
			r.Unavailable = r.MissingCount >= 2
			recipes[r.ID] = r
		}
	}
	next.Recipes = []Recipe{}
	for _, r := range recipes {
		next.Recipes = append(next.Recipes, r)
	}
	slices.SortFunc(next.Recipes, func(a, b Recipe) int {
		if a.ID < b.ID {
			return -1
		}
		if a.ID > b.ID {
			return 1
		}
		return 0
	})
	old := map[string]Item{}
	for _, i := range previous.Items {
		old[i.ID] = i
	}
	for n := range next.Items {
		i := &next.Items[n]
		before := old[i.ID]
		if slices.Contains(incoming.ObservedItems, i.ID) {
			i.Observed = true
		} else if before.Observed {
			i.Observed = true
			i.MissingCount = min(before.MissingCount+1, 2)
			i.Unavailable = i.MissingCount >= 2
		}
	}
	next.Version = CatalogVersion(next)
	return next
}

// CatalogVersion fingerprints calculation data, excluding unlocks and sync diagnostics.
func CatalogVersion(c Catalog) string {
	c.Version = ""
	c.Unlocks = nil
	c.SyncError = ""
	c.ObservedItems = nil
	c.Recipes = slices.Clone(c.Recipes)
	c.Items = slices.Clone(c.Items)
	for i := range c.Recipes {
		c.Recipes[i].MissingCount = 0
	}
	for i := range c.Items {
		c.Items[i].MissingCount = 0
		c.Items[i].Observed = false
	}
	data, _ := json.Marshal(c)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:8])
}

// Sync atomically merges a validated snapshot with the last known catalog.
func (s *Service) Sync(ctx context.Context, sid string, incoming Catalog) error {
	if _, err := NewIndex(incoming); err != nil {
		return err
	}
	s.syncMu.Lock()
	defer s.syncMu.Unlock()
	old, _, err := s.store.LoadPlanner(ctx, sid)
	if err != nil {
		return err
	}
	next := MergeCatalog(old, incoming)
	if reflect.DeepEqual(old, next) {
		return nil
	}
	if err := s.store.SavePlannerCatalog(ctx, sid, next); err != nil {
		return err
	}
	s.changed(sid)
	return nil
}

// SyncFailure reports a failed refresh while preserving the usable catalog.
func (s *Service) SyncFailure(ctx context.Context, sid, message string) {
	s.syncMu.Lock()
	defer s.syncMu.Unlock()
	c, _, err := s.store.LoadPlanner(ctx, sid)
	if err != nil || c.SyncError == message {
		return
	}
	c.SyncError = message
	if s.store.SavePlannerCatalog(ctx, sid, c) == nil {
		s.changed(sid)
	}
}

// UpdateUnlocks applies schematic polling without invalidating calculation data.
func (s *Service) UpdateUnlocks(ctx context.Context, sid string, unlocks []Unlock) error {
	s.syncMu.Lock()
	defer s.syncMu.Unlock()
	c, _, err := s.store.LoadPlanner(ctx, sid)
	if err != nil {
		return err
	}
	known := map[string]bool{}
	for _, r := range c.Recipes {
		known[r.ID] = true
	}
	unlocks = slices.DeleteFunc(slices.Clone(unlocks), func(u Unlock) bool { return !known[u.RecipeID] })
	slices.SortFunc(unlocks, func(a, b Unlock) int {
		if a.RecipeID < b.RecipeID {
			return -1
		}
		if a.RecipeID > b.RecipeID {
			return 1
		}
		return 0
	})
	if reflect.DeepEqual(c.Unlocks, unlocks) {
		return nil
	}
	c.Unlocks = unlocks
	if err := s.store.SavePlannerCatalog(ctx, sid, c); err != nil {
		return err
	}
	s.changed(sid)
	return nil
}

// Change contains the durable revisions used to refresh subscribed planners.
type Change struct {
	Revision       string            `json:"revision"`
	CatalogVersion string            `json:"catalogVersion"`
	Diagrams       []DiagramRevision `json:"diagrams"`
}

// DiagramRevision identifies one authored document revision.
type DiagramRevision struct {
	CalculationKey string `json:"calculationKey"`
	ID             string `json:"id"`
	Revision       int    `json:"revision"`
}

// Revision reads the latest workspace notification without running the solver.
func (s *Service) Revision(ctx context.Context, sid string) (*Change, error) {
	w, err := s.Load(ctx, sid, false)
	if err != nil {
		return nil, err
	}
	c := &Change{Revision: w.Revision, CatalogVersion: w.Catalog.Version, Diagrams: []DiagramRevision{}}
	for _, d := range w.Diagrams {
		c.Diagrams = append(c.Diagrams, DiagramRevision{ID: d.ID, Revision: d.Revision, CalculationKey: d.CalculationKey})
	}
	return c, nil
}

func (s *Service) changed(sid string) {
	if s.OnChange != nil {
		s.OnChange(sid)
	}
}
