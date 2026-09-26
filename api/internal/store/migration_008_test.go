package store_test

import (
	"api/internal/planner"
	"encoding/json"
	"testing"
)

func TestMigration008PreservesExistingExportsAndPrivateSections(t *testing.T) {
	db := openTestDB(t)
	migrateTo(t, db, 7)
	if _, err := db.Exec(`INSERT INTO sessions (id, name, address, save_name) VALUES ('s', 'Factory', 'localhost', 'Save')`); err != nil {
		t.Fatal(err)
	}
	docs := map[string]string{
		"child":  `{"name":"Child","nodes":[{"id":"root","kind":"output","parentId":"","itemId":"wire","rate":120},{"id":"private","kind":"output","parentId":"section","itemId":"rod","rate":20},{"id":"linked","kind":"output","parentId":"section","itemId":"plate","rate":30},{"id":"local","kind":"output","parentId":"section","itemId":"wire","rate":40},{"id":"machine","kind":"production","status":"built","builtFingerprint":"keep","x":123}],"connections":[{"id":"use","source":"local","target":"machine","itemId":"wire"}]}`,
		"parent": `{"nodes":[{"id":"factory","kind":"link","linkedDiagramId":"child"}],"connections":[{"source":"factory","sourcePort":"linked","target":"target","itemId":"plate"}]}`,
		"empty":  `{"nodes":[],"connections":[]}`,
	}
	for id, doc := range docs {
		if _, err := db.Exec(`INSERT INTO planner_diagrams (id, session_id, revision, document) VALUES (?, 's', 9, ?)`, id, doc); err != nil {
			t.Fatal(err)
		}
	}
	migrateTo(t, db, 8)
	var raw string
	var revision int
	if err := db.QueryRow(`SELECT document, revision FROM planner_diagrams WHERE id = 'child'`).Scan(&raw, &revision); err != nil {
		t.Fatal(err)
	}
	var doc planner.Document
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatal(err)
	}
	if revision != 9 || doc.Name != "Child" || len(doc.Nodes) != 5 || len(doc.Connections) != 1 {
		t.Fatal("lost document content", raw)
	}
	for _, n := range doc.Nodes {
		if n.OutputRateMode != "fixed" {
			t.Fatal("missing fixed default", n)
		}
		if n.Exposed != (n.ID == "root" || n.ID == "linked" || n.ID == "local") {
			t.Fatal("incorrect export visibility", n)
		}
		if n.ID == "machine" && (n.Status != "built" || n.BuiltFingerprint != "keep" || n.X != 123) {
			t.Fatal("construction data changed", n)
		}
	}
	if err := db.QueryRow(`SELECT document FROM planner_diagrams WHERE id='empty'`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if raw != docs["empty"] {
		t.Fatal("empty document changed", raw)
	}
	migrateTo(t, db, 7)
	if err := db.QueryRow(`SELECT document FROM planner_diagrams WHERE id='child'`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var before, after any
	_ = json.Unmarshal([]byte(docs["child"]), &before)
	_ = json.Unmarshal([]byte(raw), &after)
	a, _ := json.Marshal(before)
	b, _ := json.Marshal(after)
	if string(a) != string(b) {
		t.Fatal("down migration changed existing content", raw)
	}
}
