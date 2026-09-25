-- name: ListPlannerDiagrams :many
SELECT id, session_id, revision, document, updated_at FROM planner_diagrams
WHERE session_id = sqlc.arg(session_id) ORDER BY id;

-- name: InsertPlannerDiagram :exec
INSERT INTO planner_diagrams(id, session_id, document) VALUES (?, ?, ?);

-- name: UpdatePlannerDiagram :execrows
UPDATE planner_diagrams SET document = sqlc.arg(document), revision = revision + 1,
updated_at = CURRENT_TIMESTAMP
WHERE id = sqlc.arg(id) AND session_id = sqlc.arg(session_id) AND revision = sqlc.arg(revision);

-- name: DeletePlannerDiagram :execrows
DELETE FROM planner_diagrams WHERE id = sqlc.arg(id) AND session_id = sqlc.arg(session_id)
AND revision = sqlc.arg(revision);

-- name: DeletePlannerDependencies :exec
DELETE FROM planner_dependencies WHERE diagram_id = ?;

-- name: InsertPlannerDependency :exec
INSERT INTO planner_dependencies(diagram_id, target_id, session_id) VALUES (?, ?, ?);

-- name: GetPlannerConsumers :many
SELECT diagram_id FROM planner_dependencies WHERE target_id = ? ORDER BY diagram_id;

-- name: GetPlannerCatalog :one
SELECT catalog FROM planner_catalogs WHERE session_id = ?;

-- name: SavePlannerCatalog :exec
INSERT INTO planner_catalogs(session_id, catalog) VALUES (?, ?)
ON CONFLICT(session_id) DO UPDATE SET catalog = excluded.catalog;
