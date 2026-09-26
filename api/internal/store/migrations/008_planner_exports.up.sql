UPDATE planner_diagrams
SET document = json_set(document, '$.nodes', json((
    SELECT json_group_array(json(json_set(node.value,
        '$.outputRateMode', 'fixed',
        '$.exposed', json(CASE WHEN json_extract(node.value, '$.kind') = 'output' AND (
            COALESCE(json_extract(node.value, '$.parentId'), '') = '' OR EXISTS (
                SELECT 1 FROM planner_diagrams parent, json_each(parent.document, '$.nodes') link,
                    json_each(parent.document, '$.connections') connection
                WHERE parent.session_id = planner_diagrams.session_id
                    AND json_extract(link.value, '$.linkedDiagramId') = planner_diagrams.id
                    AND json_extract(connection.value, '$.source') = json_extract(link.value, '$.id')
                    AND (json_extract(connection.value, '$.sourcePort') = json_extract(node.value, '$.id')
                        OR COALESCE(json_extract(connection.value, '$.sourcePort'), '') = '')
                    AND json_extract(connection.value, '$.itemId') = json_extract(node.value, '$.itemId')
            ) OR EXISTS (
                SELECT 1 FROM json_each(planner_diagrams.document, '$.connections') edge
                WHERE json_extract(edge.value, '$.source') = json_extract(node.value, '$.id')
            )
        ) THEN 'true' ELSE 'false' END)
    ))) FROM json_each(planner_diagrams.document, '$.nodes') node
)));
