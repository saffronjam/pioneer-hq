package store_test

import (
	"encoding/json"
	"strings"
	"testing"

	"api/internal/planner"
	"api/internal/session"
)

func transferDocument(name string) planner.Document {
	return planner.Document{Version: 1, Name: name, Viewport: planner.Viewport{Zoom: 1}, Nodes: []planner.Node{}, Connections: []planner.Connection{}, Settings: planner.Settings{Recipes: []planner.RecipeChoice{}}}
}

func TestPlannerTransferRoundTrip(t *testing.T) {
	st, ctx := newStore(t)
	seedSession(t, st, ctx)
	service := planner.NewService(st)
	child, err := service.Save(ctx, string(testSession), "", 0, transferDocument("Child"), false)
	if err != nil {
		t.Fatal(err)
	}
	doc := transferDocument("Root")
	doc.Nodes = []planner.Node{
		{ID: "a", Kind: "link", LinkedDiagramID: child.ID, Status: "planned", X: 10, Y: 20},
		{ID: "b", Kind: "link", LinkedDiagramID: child.ID, Status: "planned", X: 30, Y: 40},
	}
	root, err := service.Save(ctx, string(testSession), "", 0, doc, false)
	if err != nil {
		t.Fatal(err)
	}
	data, err := service.Export(ctx, string(testSession), root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(data, string(testSession)) {
		t.Fatal("export contains session identity")
	}
	preview, rootID, err := service.ValidateImport(ctx, string(testSession), data)
	if err != nil || len(preview) != 2 || rootID != root.ID {
		t.Fatal(preview, rootID, err)
	}
	before, err := service.Load(ctx, string(testSession), false)
	if err != nil || len(before.Diagrams) != 2 {
		t.Fatal("preview wrote plans", err)
	}
	for _, duplicate := range []bool{false, true} {
		var copy *planner.Diagram
		if duplicate {
			copy, err = service.Duplicate(ctx, string(testSession), root.ID, "Duplicate")
		} else {
			copy, err = service.Import(ctx, string(testSession), "Imported", data)
		}
		if err != nil {
			t.Fatal(err)
		}
		if copy.ID == root.ID || copy.Revision != 1 || copy.CalculationKey == "" {
			t.Fatal("copy has invalid identity", copy)
		}
		if copy.Document.Nodes[0].LinkedDiagramID == child.ID || copy.Document.Nodes[0].LinkedDiagramID != copy.Document.Nodes[1].LinkedDiagramID {
			t.Fatal("shared dependency was not independently copied once")
		}
		if copy.Document.Nodes[0].X != 10 || copy.Document.Nodes[1].Y != 40 {
			t.Fatal("copy changed positions")
		}
	}
	workspace, err := service.Load(ctx, string(testSession), false)
	if err != nil || len(workspace.Diagrams) != 6 {
		t.Fatal("wrong import count", err)
	}
	if _, err := service.Export(ctx, string(testSession), "missing"); err == nil {
		t.Fatal("export accepted missing plan")
	}
	if err := st.CreateSession(ctx, session.ID("destination"), "Destination", "localhost:1234", "Destination save"); err != nil {
		t.Fatal(err)
	}
	imported, err := service.Import(ctx, "destination", "Cross-session", data)
	if err != nil || imported.SessionID != "destination" {
		t.Fatal("portable import failed", err)
	}
	if _, err := service.Export(ctx, "destination", root.ID); err == nil {
		t.Fatal("export crossed session boundary")
	}
}

func TestPlannerImportRejectsInvalidFilesWithoutWrites(t *testing.T) {
	st, ctx := newStore(t)
	seedSession(t, st, ctx)
	service := planner.NewService(st)
	root, err := service.Save(ctx, string(testSession), "", 0, transferDocument("Root"), false)
	if err != nil {
		t.Fatal(err)
	}
	data, err := service.Export(ctx, string(testSession), root.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"{", "{}", data + "{}", strings.Replace(data, "pioneer-hq-plan", "other-plan", 1), strings.Repeat(" ", 10*1024*1024+1)} {
		if _, err := service.Import(ctx, string(testSession), "Invalid", value); err == nil {
			t.Fatal("invalid file accepted")
		}
	}
	var file map[string]any
	if err := json.Unmarshal([]byte(data), &file); err != nil {
		t.Fatal(err)
	}
	diagrams := file["diagrams"].([]any)
	doc := diagrams[0].(map[string]any)["document"].(map[string]any)
	for _, target := range []string{"missing", root.ID} {
		doc["nodes"] = []planner.Node{{ID: "link", Kind: "link", LinkedDiagramID: target, Status: "planned"}}
		invalid, _ := json.Marshal(file)
		if _, err := service.Import(ctx, string(testSession), "Invalid", string(invalid)); err == nil {
			t.Fatal("missing/circular dependency accepted")
		}
	}
	workspace, err := service.Load(ctx, string(testSession), false)
	if err != nil || len(workspace.Diagrams) != 1 {
		t.Fatal("invalid import left partial plans", err)
	}
}

func TestPlannerImportRollsBackInsertFailure(t *testing.T) {
	st, ctx := newStore(t)
	seedSession(t, st, ctx)
	if err := st.CreateSession(ctx, session.ID("other"), "Other", "localhost:1234", "Other save"); err != nil {
		t.Fatal(err)
	}
	other, err := st.SavePlanner(ctx, "other", "", 0, transferDocument("Other"))
	if err != nil {
		t.Fatal(err)
	}
	err = st.ImportPlanner(ctx, string(testSession), []planner.Diagram{
		{ID: "new", SessionID: string(testSession), Document: transferDocument("New")},
		{ID: other.ID, SessionID: string(testSession), Document: transferDocument("Collision")},
	})
	if err == nil {
		t.Fatal("identity collision accepted")
	}
	_, diagrams, err := st.LoadPlanner(ctx, string(testSession))
	if err != nil || len(diagrams) != 0 {
		t.Fatal("transaction left a partial import", err)
	}
}

func TestSurplusPreferenceSurvivesSaveAndTransfer(t *testing.T) {
	st, ctx := newStore(t)
	seedSession(t, st, ctx)
	service := planner.NewService(st)
	doc := transferDocument("Recycled products")
	doc.Settings.Recipes = []planner.RecipeChoice{
		{ItemID: "Desc_Plastic_C", RecipeID: "Recipe_Alternate_Plastic_1_C"},
		{ItemID: "Desc_Rubber_C", RecipeID: "Recipe_Alternate_RecycledRubber_C", SurplusRecipeID: "Recipe_ResidualRubber_C"},
		{ItemID: "Desc_LiquidFuel_C", RecipeID: "Recipe_Alternate_DilutedFuel_C"},
		{ItemID: "Desc_HeavyOilResidue_C", RecipeID: "Recipe_Alternate_HeavyOilResidue_C"},
	}
	doc.Nodes = []planner.Node{
		{ID: "plastic", Kind: "output", ItemID: "Desc_Plastic_C", Rate: 300, Status: "planned"},
		{ID: "rubber", Kind: "output", ItemID: "Desc_Rubber_C", Rate: 300, Status: "planned"},
	}
	saved, err := service.Save(ctx, string(testSession), "", 0, doc, true)
	if err != nil {
		t.Fatal(err)
	}
	surplusID := ""
	for _, n := range saved.Document.Nodes {
		if n.Surplus {
			surplusID = n.ID
		}
	}
	if surplusID == "" {
		t.Fatal("missing surplus production")
	}
	saved.Document.Name = "Recycled products renamed"
	saved, err = service.Save(ctx, string(testSession), saved.ID, saved.Revision, saved.Document, false)
	if err != nil {
		t.Fatal("ordinary save rejected surplus node", err)
	}
	data, err := service.Export(ctx, string(testSession), saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	imported, err := service.Import(ctx, string(testSession), "Imported loop", data)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, n := range imported.Document.Nodes {
		found = found || n.Surplus && n.RecipeID == "Recipe_ResidualRubber_C"
	}
	if !found {
		t.Fatal("import lost surplus production")
	}
	workspace, err := service.Load(ctx, string(testSession), true)
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range workspace.Calculations {
		if !result.Resolved {
			t.Fatal("saved loop unresolved")
		}
		for _, diag := range result.Diagnostics {
			if diag.Code != "surplus" {
				t.Fatal(diag)
			}
		}
	}
	for i := range saved.Document.Settings.Recipes {
		saved.Document.Settings.Recipes[i].SurplusRecipeID = ""
	}
	saved, err = service.Save(ctx, string(testSession), saved.ID, saved.Revision, saved.Document, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range saved.Document.Nodes {
		if n.Surplus || n.ID == surplusID {
			t.Fatal("removal retained surplus node")
		}
	}
}
