UPDATE planner_diagrams
SET document = json_set(document,
    '$.nodes', json((SELECT json_group_array(json(json_remove(value, '$.inputRateMode'))) FROM json_each(planner_diagrams.document, '$.nodes'))),
    '$.connections', json((SELECT json_group_array(json(json_remove(value, '$.generated'))) FROM json_each(planner_diagrams.document, '$.connections')))
);
