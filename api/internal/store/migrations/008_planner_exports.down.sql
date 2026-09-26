UPDATE planner_diagrams
SET document = json_set(document, '$.nodes', json((
    SELECT json_group_array(json(json_remove(value, '$.outputRateMode', '$.exposed')))
    FROM json_each(planner_diagrams.document, '$.nodes')
)));
