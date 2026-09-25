package planner

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
)

// Store persists planner state without exposing SQL to calculations.
type Store interface {
	LoadPlanner(context.Context, string) (Catalog, []Diagram, error)
	SavePlanner(context.Context, string, string, int, Document) (Diagram, error)
	DeletePlanner(context.Context, string, string, int) error
	SavePlannerCatalog(context.Context, string, Catalog) error
}

// Service coordinates durable editing and bounded calculation work.
type Service struct {
	OnChange     func(string)
	syncMu       sync.Mutex
	store        Store
	calculations chan struct{}
}

// NewService creates a planner service with one concurrent solver to bound memory use.
func NewService(s Store) *Service { return &Service{store: s, calculations: make(chan struct{}, 1)} }

func workspaceRevision(c Catalog, ds []Diagram) string {
	b, _ := json.Marshal(struct {
		Catalog  Catalog
		Diagrams []Diagram
	}{c, ds})
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// Load returns the catalog and documents with optional material results.
func (s *Service) Load(ctx context.Context, sid string, calculate bool) (*Workspace, error) {
	c, ds, err := s.store.LoadPlanner(ctx, sid)
	if err != nil {
		return nil, err
	}
	w := &Workspace{Revision: workspaceRevision(c, ds), Catalog: c, Diagrams: ds, Calculations: []Calculation{}}
	if calculate {
		select {
		case s.calculations <- struct{}{}:
			defer func() { <-s.calculations }()
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		w.Calculations, err = Calculate(ctx, c, ds, w.Revision)
		if err != nil {
			return nil, err
		}
	}
	return w, nil
}

// Save validates and optionally expands production before saving a diagram.
func (s *Service) Save(ctx context.Context, sid, id string, expected int, doc Document, expand bool) (*Diagram, error) {
	c, ds, err := s.store.LoadPlanner(ctx, sid)
	if err != nil {
		return nil, err
	}

	if expand {
		doc, err = Expand(doc, c)
		if err != nil {
			return nil, err
		}
	} else if err := Validate(doc, c); err != nil {
		return nil, err
	}
	x, _ := NewIndex(c)
	for _, n := range doc.Nodes {
		if n.Kind == "production" {
			r, ok := chooseRecipe(doc, n.ParentID, n.ItemID, x)
			if !x.Recipes[n.RecipeID].Unavailable && (!ok || r.ID != n.RecipeID) {
				return nil, fmt.Errorf("recipe on %s must follow its group policy; calculate to apply recipe preferences", n.Name)
			}
		}
	}
	doc.CatalogVersion = c.Version
	previous := map[string]Node{}
	for _, d := range ds {
		if d.ID == id {
			previous = nodeMap(d.Document)
		}
	}
	needsFingerprint := false
	for i := range doc.Nodes {
		n := &doc.Nodes[i]
		if n.Status != "built" {
			n.BuiltFingerprint = ""
		} else if previous[n.ID].Status == "built" {
			n.BuiltFingerprint = previous[n.ID].BuiltFingerprint
		} else {
			needsFingerprint = true
			n.BuiltFingerprint = ""
		}
	}
	if needsFingerprint {
		candidate := Diagram{ID: id, SessionID: sid, Document: doc}
		if id == "" {
			candidate.ID = "new"
		}
		found := false
		for i := range ds {
			if ds[i].ID == id {
				ds[i] = candidate
				found = true
			}
		}
		if !found {
			ds = append(ds, candidate)
		}
		select {
		case s.calculations <- struct{}{}:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		rs, calcErr := Calculate(ctx, c, ds, "")
		<-s.calculations
		if calcErr != nil {
			return nil, fmt.Errorf("calculate before marking built: %w", calcErr)
		}
		for _, r := range rs {
			if r.DiagramID == candidate.ID {
				for _, nr := range r.Nodes {
					for i := range doc.Nodes {
						if doc.Nodes[i].ID == nr.NodeID && doc.Nodes[i].Status == "built" && doc.Nodes[i].BuiltFingerprint == "" {
							doc.Nodes[i].BuiltFingerprint = nr.Fingerprint
						}
					}
				}
			}
		}
	}
	saved, err := s.store.SavePlanner(ctx, sid, id, expected, doc)
	if err == nil && saved.Revision != expected {
		s.changed(sid)
	}
	return &saved, err
}

// Delete rejects removal of a factory with consumers.
func (s *Service) Delete(ctx context.Context, sid, id string, revision int) error {
	err := s.store.DeletePlanner(ctx, sid, id, revision)
	if err == nil {
		s.changed(sid)
	}
	return err
}

// SetCatalog retains a validated FRM snapshot for offline planning.
func (s *Service) SetCatalog(ctx context.Context, sid string, c Catalog) error {
	return s.store.SavePlannerCatalog(ctx, sid, c)
}
