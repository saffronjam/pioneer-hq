UPDATE planner_diagrams
SET document = json_set(document, '$.nodes', json((
    SELECT json_group_array(json(CASE WHEN json_extract(value, '$.kind') = 'miner'
        THEN json_set(value, '$.kind', 'supply') ELSE value END))
    FROM json_each(planner_diagrams.document, '$.nodes')
)))
WHERE EXISTS (SELECT 1 FROM json_each(document, '$.nodes') WHERE json_extract(value, '$.kind') = 'miner');
