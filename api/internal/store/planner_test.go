package store_test

import (
	"api/internal/planner"
	"api/internal/session"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestPlannerDisabledOutputsPersistAcrossPreviewSaveAndTransfer(t *testing.T) {
	st, ctx := newStore(t)
	seedSession(t, st, ctx)
	service := planner.NewService(st)
	doc := planner.Document{Version: 1, Name: "Scrap", Viewport: planner.Viewport{Zoom: 1}, Nodes: []planner.Node{
		{ID: "out", Kind: "output", ItemID: "Desc_AluminumScrap_C", Rate: 300, Clock: 100, Status: "planned"},
	}}
	saved, err := service.Save(ctx, string(testSession), "", 0, doc, true)
	if err != nil {
		t.Fatal(err)
	}
	doc = saved.Document
	id := ""
	for i := range doc.Nodes {
		if doc.Nodes[i].Kind == "production" && doc.Nodes[i].ItemID == "Desc_AluminumScrap_C" {
			id = doc.Nodes[i].ID
			doc.Nodes[i].DisabledOutputs = []string{"Desc_Water_C"}
		}
	}
	preview, err := service.Preview(ctx, string(testSession), saved.ID, doc)
	if err != nil {
		t.Fatal(err)
	}
	check := func(d planner.Document) {
		t.Helper()
		if !slices.ContainsFunc(d.Nodes, func(n planner.Node) bool {
			return n.ID == id && n.Generated && slices.Equal(n.DisabledOutputs, []string{"Desc_Water_C"})
		}) {
			t.Fatal("disabled output setting was lost")
		}
	}
	check(preview.Diagrams[0].Document)
	if preview.Diagrams[0].CalculationKey == saved.CalculationKey {
		t.Fatal("disabling an output did not invalidate the calculation")
	}
	saved, err = service.Save(ctx, string(testSession), saved.ID, saved.Revision, preview.Diagrams[0].Document, false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := service.Load(ctx, string(testSession), true)
	if err != nil {
		t.Fatal(err)
	}
	check(w.Diagrams[0].Document)
	exported, err := service.Export(ctx, string(testSession), saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	imported, err := service.Import(ctx, string(testSession), "Imported scrap", exported)
	if err != nil {
		t.Fatal(err)
	}
	check(imported.Document)
	duplicate, err := service.Duplicate(ctx, string(testSession), saved.ID, "Copied scrap")
	if err != nil {
		t.Fatal(err)
	}
	check(duplicate.Document)
}

func TestPlannerConstructionMetadataOnCachedCatalog(t *testing.T) {
	st, ctx := newStore(t)
	seedSession(t, st, ctx)
	c := planner.BundledCatalog()
	for i := range c.Machines {
		c.Machines[i].BuildCost = nil
	}
	c.SyncError = "offline"
	for i := range c.Recipes {
		if c.Recipes[i].ID == "Recipe_PackagedTurboFuel_C" {
			c.Recipes[i].Alternate = true
		}
	}
	if err := st.SavePlannerCatalog(ctx, string(testSession), c); err != nil {
		t.Fatal(err)
	}
	loaded, _, err := st.LoadPlanner(ctx, string(testSession))
	if err != nil {
		t.Fatal(err)
	}
	if loaded.SyncError != "offline" {
		t.Fatal("loading construction metadata changed sync state")
	}
	for _, recipe := range loaded.Recipes {
		if recipe.ID == "Recipe_PackagedTurboFuel_C" && recipe.Alternate {
			t.Fatal("cached recipe classification overrode game metadata")
		}
	}
	if loaded.Version == c.Version {
		t.Fatal("catalog metadata did not invalidate the calculation version")
	}
	for _, machine := range loaded.Machines {
		if len(machine.BuildCost) == 0 {
			t.Fatalf("missing construction cost for %s", machine.Name)
		}
	}
	if _, err := planner.NewIndex(loaded); err != nil {
		t.Fatal(err)
	}
}

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

func TestPlannerSupplyPruningAndLayoutKeys(t *testing.T) {
	st, ctx := newStore(t)
	seedSession(t, st, ctx)
	service := planner.NewService(st)
	doc := planner.Document{Version: 1, Name: "Cable", Viewport: planner.Viewport{Zoom: 1}, Settings: planner.Settings{Recipes: []planner.RecipeChoice{}}, Nodes: []planner.Node{
		{ID: "out", Kind: "output", ItemID: "Desc_Cable_C", Rate: 60, Clock: 100, Status: "built"},
		{ID: "wire", Kind: "supply", ItemID: "Desc_Wire_C", Rate: 300, Clock: 100, Status: "planned"},
	}, Connections: []planner.Connection{}}
	saved, err := service.Save(ctx, string(testSession), "", 0, doc, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Document.Nodes) != 3 {
		t.Fatalf("idle wire/copper branch retained: %+v", saved.Document.Nodes)
	}
	if saved.Document.Nodes[0].Status != "planned" {
		t.Fatal("boundary has construction state")
	}
	before, err := service.Load(ctx, string(testSession), true)
	if err != nil {
		t.Fatal(err)
	}
	key := saved.CalculationKey
	if key == "" || before.Calculations[0].CalculationKey != key {
		t.Fatal("missing calculation identity")
	}
	saved.Document.Nodes[0].X = 123
	moved, err := service.Save(ctx, string(testSession), saved.ID, saved.Revision, saved.Document, false)
	if err != nil {
		t.Fatal(err)
	}
	if moved.CalculationKey != key || moved.Revision == saved.Revision {
		t.Fatal("position save must change only the document revision")
	}
	change, err := service.Revision(ctx, string(testSession))
	if err != nil {
		t.Fatal(err)
	}
	if change.Diagrams[0].CalculationKey != key {
		t.Fatal("notification invalidates material results")
	}
}

func TestDemandExportPersistsAndActivatesFromLinkedFactory(t *testing.T) {
	st, ctx := newStore(t)
	seedSession(t, st, ctx)
	service := planner.NewService(st)
	doc := planner.Document{Version: 1, Name: "Wire factory", Viewport: planner.Viewport{Zoom: 1}, Settings: planner.Settings{Recipes: []planner.RecipeChoice{}}, Nodes: []planner.Node{
		{ID: "wire", Kind: "output", ItemID: "Desc_Wire_C", OutputRateMode: "demand", Exposed: true, Rate: 999, Clock: 100, Status: "planned"},
	}, Connections: []planner.Connection{}}
	child, err := service.Save(ctx, string(testSession), "", 0, doc, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(child.Document.Nodes) < 2 || child.Document.Nodes[0].Rate != 0 || !child.Document.Nodes[0].Exposed {
		t.Fatal("idle export was not normalized or lost its production chain", child.Document)
	}
	parentDoc := planner.Document{Version: 1, Name: "Cable factory", Viewport: planner.Viewport{Zoom: 1}, Settings: doc.Settings, Nodes: []planner.Node{
		{ID: "link", Kind: "link", LinkedDiagramID: child.ID, Status: "planned"},
		{ID: "cable", Kind: "output", ItemID: "Desc_Cable_C", Rate: 30, Clock: 100, Status: "planned"},
	}, Connections: []planner.Connection{}}
	parent, err := service.Save(ctx, string(testSession), "", 0, parentDoc, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range parent.Document.Nodes {
		if n.Kind == "production" && n.ItemID == "Desc_Wire_C" {
			t.Fatal("parent duplicated linked production")
		}
	}
	w, err := service.Load(ctx, string(testSession), true)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, c := range w.Calculations {
		if c.DiagramID != child.ID {
			continue
		}
		for _, n := range c.Nodes {
			if n.NodeID == "wire" {
				found = true
				if n.ExportRate != 60 || len(n.Outputs) != 1 || n.Outputs[0].Rate != 60 || n.SurplusRate != 0 {
					t.Fatal("linked demand failed to activate the saved factory", n)
				}
			}
		}
	}
	if !found {
		t.Fatal("missing persisted export result")
	}
}

func TestPlannerPreviewDoesNotSaveOrNotify(t *testing.T) {
	st, ctx := newStore(t)
	seedSession(t, st, ctx)
	service := planner.NewService(st)
	doc := planner.Document{Version: 1, Name: "Cable", Viewport: planner.Viewport{Zoom: 1}, Settings: planner.Settings{Recipes: []planner.RecipeChoice{}}, Nodes: []planner.Node{
		{ID: "out", Kind: "output", ItemID: "Desc_Cable_C", Rate: 60, Clock: 100, Status: "planned"},
		{ID: "wire", Kind: "supply", ItemID: "Desc_Wire_C", Rate: 300, Clock: 100, Status: "planned"},
	}, Connections: []planner.Connection{}}
	saved, err := service.Save(ctx, string(testSession), "", 0, doc, false)
	if err != nil {
		t.Fatal(err)
	}
	before, err := service.Load(ctx, string(testSession), false)
	if err != nil {
		t.Fatal(err)
	}
	notifications := 0
	service.OnChange = func(string) { notifications++ }
	doc.Name = "Draft cable"
	preview, err := service.Preview(ctx, string(testSession), saved.ID, doc)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Diagrams[0].Document.Nodes) != 3 || preview.Diagrams[0].Document.Name != doc.Name {
		t.Fatalf("preview did not expand and prune draft: %+v", preview.Diagrams[0])
	}
	if !preview.Calculations[0].Resolved || preview.Calculations[0].CalculationKey != preview.Diagrams[0].CalculationKey {
		t.Fatal("preview results do not match the expanded document")
	}
	after, err := service.Load(ctx, string(testSession), false)
	if err != nil {
		t.Fatal(err)
	}
	if before.Revision != after.Revision || after.Diagrams[0].Document.Name != "Cable" || len(after.Diagrams[0].Document.Nodes) != 2 || notifications != 0 {
		t.Fatal("preview changed persistent state or emitted a notification")
	}
	if _, err := service.Preview(ctx, "other", saved.ID, doc); err == nil {
		t.Fatal("cross-session preview accepted")
	}
	persisted, err := service.Save(ctx, string(testSession), saved.ID, saved.Revision, preview.Diagrams[0].Document, false)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Revision <= saved.Revision || persisted.Document.Name != doc.Name || notifications != 1 {
		t.Fatal("explicit save did not persist preview")
	}
}
