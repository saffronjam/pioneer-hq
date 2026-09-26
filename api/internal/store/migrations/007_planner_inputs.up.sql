UPDATE planner_diagrams
SET document = json_set(document,
    '$.nodes', json((SELECT json_group_array(json(json_set(value,
        '$.inputRateMode', 'calculated',
        '$.status', CASE WHEN json_extract(value, '$.kind') IN ('input', 'supply', 'output') THEN 'planned' ELSE json_extract(value, '$.status') END,
        '$.builtFingerprint', CASE WHEN json_extract(value, '$.kind') IN ('input', 'supply', 'output') THEN '' ELSE json_extract(value, '$.builtFingerprint') END
    ))) FROM json_each(planner_diagrams.document, '$.nodes'))),
    '$.connections', json((SELECT json_group_array(json(json_set(edge.value, '$.generated', json(CASE WHEN EXISTS (
        SELECT 1 FROM json_each(planner_diagrams.document, '$.nodes') node
        WHERE json_extract(node.value, '$.id') = json_extract(edge.value, '$.source') AND json_extract(node.value, '$.generated') = 1
    ) THEN 'true' ELSE 'false' END)))) FROM json_each(planner_diagrams.document, '$.connections') edge))
);
