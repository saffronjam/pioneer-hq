package store_test

import (
	"api/internal/planner"
	"api/internal/session"
	"strings"
	"testing"
	"time"
)

func TestPlannerOwnershipRevisionsAndDependencies(t *testing.T) {
	st, ctx := newStore(t)
	seedSession(t, st, ctx)
	if err := st.CreateSession(ctx, session.ID("other"), "Other", "localhost:1234", "Other save"); err != nil {
		t.Fatal(err)
	}
	service := planner.NewService(st)
	doc := planner.Document{Version: 1, Name: "Child", Viewport: planner.Viewport{Zoom: 1}, Nodes: []planner.Node{}, Connections: []planner.Connection{}, Settings: planner.Settings{Recipes: []planner.RecipeChoice{}}}
	child, err := service.Save(ctx, string(testSession), "", 0, doc, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Save(ctx, "other", child.ID, child.Revision, doc, false); err == nil {
		t.Fatal("cross-session update accepted")
	}
	doc.Name = "Renamed child"
	changed, err := service.Save(ctx, string(testSession), child.ID, child.Revision, doc, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Save(ctx, string(testSession), child.ID, child.Revision, doc, false); err == nil || !strings.Contains(err.Error(), "CONFLICT") {
		t.Fatal("stale revision accepted", err)
	}
	doc.Name = "Parent"
	doc.Nodes = []planner.Node{{ID: "link", Kind: "link", Status: "planned", LinkedDiagramID: child.ID}}
	if _, err = service.Save(ctx, "other", "", 0, doc, false); err == nil {
		t.Fatal("cross-session link accepted")
	}
	parent, err := service.Save(ctx, string(testSession), "", 0, doc, false)
	if err != nil {
		t.Fatal(err)
	}
	doc.Nodes[0].LinkedDiagramID = parent.ID
	if _, err = service.Save(ctx, string(testSession), child.ID, changed.Revision, doc, false); err == nil {
		t.Fatal("circular imports accepted")
	}
	if err = service.Delete(ctx, string(testSession), child.ID, changed.Revision); err == nil {
		t.Fatal("referenced factory deleted")
	}
	w, err := service.Load(ctx, string(testSession), true)
	if err != nil {
		t.Fatal(err)
	}
	if len(w.Diagrams) != 2 {
		t.Fatal(w)
	}
	other, err := service.Load(ctx, "other", false)
	if err != nil || len(other.Diagrams) != 0 {
		t.Fatal("session isolation", err)
	}
	if err = st.DeleteSession(ctx, testSession); err != nil {
		t.Fatal("session cascade", err)
	}
}

func TestPlannerNoopSaveAndCatalogSync(t *testing.T) {
	st, ctx := newStore(t)
	seedSession(t, st, ctx)
	service := planner.NewService(st)
	notifications := 0
	service.OnChange = func(string) { notifications++ }
	doc := planner.Document{Version: 1, Name: "Plan", Viewport: planner.Viewport{Zoom: 1}, Nodes: []planner.Node{}, Connections: []planner.Connection{}, Settings: planner.Settings{Recipes: []planner.RecipeChoice{}}}
	first, err := service.Save(ctx, string(testSession), "", 0, doc, false)
	if err != nil {
		t.Fatal(err)
	}
	same, err := service.Save(ctx, string(testSession), first.ID, first.Revision, first.Document, false)
	if err != nil {
		t.Fatal(err)
	}
	if same.Revision != first.Revision || !same.UpdatedAt.Equal(first.UpdatedAt.Truncate(time.Second)) || notifications != 1 {
		t.Fatal("no-op mutated revision or emitted event", same.Revision, notifications)
	}
	before, _ := service.Load(ctx, string(testSession), false)
	service.SyncFailure(ctx, string(testSession), "offline")
	after, _ := service.Load(ctx, string(testSession), false)
	if before.Catalog.Version != after.Catalog.Version || len(after.Catalog.Recipes) != 291 || after.Catalog.SyncError != "offline" {
		t.Fatal("sync failure discarded catalog")
	}
	incoming := planner.BundledCatalog()
	if err := service.Sync(ctx, string(testSession), incoming); err != nil {
		t.Fatal(err)
	}
	notifications = 0
	if err := service.Sync(ctx, string(testSession), incoming); err != nil {
		t.Fatal(err)
	}
	if notifications != 0 {
		t.Fatal("unchanged sync emitted notification")
	}
}
