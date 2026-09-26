package store_test

import (
	"api/internal/planner"
	"encoding/json"
	"testing"
)

func TestMigration007PreservesPlannerDocuments(t *testing.T) {
	db := openTestDB(t)
	migrateTo(t, db, 6)
	if _, err := db.Exec(`INSERT INTO sessions (id, name, address, save_name) VALUES ('s', 'Factory', 'localhost', 'Save')`); err != nil {
		t.Fatal(err)
	}
	document := `{"name":"Factory","nodes":[{"id":"input","kind":"input","rate":60,"status":"built","builtFingerprint":"old","generated":true,"x":123},{"id":"production","kind":"production","status":"built","builtFingerprint":"keep","generated":false}],"connections":[{"id":"auto","source":"input","target":"production","itemId":"ore"},{"id":"manual","source":"production","target":"input","itemId":"ingot"}]}`
	for id, doc := range map[string]string{"full": document, "empty": `{"nodes":[],"connections":[]}`} {
		if _, err := db.Exec(`INSERT INTO planner_diagrams (id, session_id, revision, document) VALUES (?, 's', 9, ?)`, id, doc); err != nil {
			t.Fatal(err)
		}
	}
	migrateTo(t, db, 7)
	var raw string
	var revision int
	if err := db.QueryRow(`SELECT document, revision FROM planner_diagrams WHERE id = 'full'`).Scan(&raw, &revision); err != nil {
		t.Fatal(err)
	}
	var doc planner.Document
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatal(err)
	}
	if revision != 9 || doc.Name != "Factory" || len(doc.Nodes) != 2 || len(doc.Connections) != 2 {
		t.Fatal("document content or revision lost", raw, revision)
	}
	input, production := doc.Nodes[0], doc.Nodes[1]
	if input.InputRateMode != "calculated" || input.Status != "planned" || input.BuiltFingerprint != "" || input.Rate != 60 || input.X != 123 {
		t.Fatal("input migration", input)
	}
	if production.Status != "built" || production.BuiltFingerprint != "keep" || !doc.Connections[0].Generated || doc.Connections[1].Generated {
		t.Fatal("construction or connection metadata lost", doc)
	}
	if err := db.QueryRow(`SELECT document FROM planner_diagrams WHERE id = 'empty'`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if raw != `{"nodes":[],"connections":[]}` {
		t.Fatal("empty document changed", raw)
	}
}
