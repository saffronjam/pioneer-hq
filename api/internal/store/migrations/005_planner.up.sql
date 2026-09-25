CREATE TABLE planner_diagrams (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 1,
    document TEXT NOT NULL CHECK(json_valid(document)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(id, session_id)
);
CREATE INDEX planner_diagrams_session ON planner_diagrams(session_id);
CREATE TABLE planner_dependencies (
    diagram_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    PRIMARY KEY(diagram_id, target_id),
    FOREIGN KEY(diagram_id, session_id) REFERENCES planner_diagrams(id, session_id) ON DELETE CASCADE,
    FOREIGN KEY(target_id, session_id) REFERENCES planner_diagrams(id, session_id) ON DELETE NO ACTION
);
CREATE TABLE planner_catalogs (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    catalog TEXT NOT NULL CHECK(json_valid(catalog))
);
