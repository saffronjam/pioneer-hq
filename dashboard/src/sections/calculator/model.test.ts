import { describe, expect, test } from 'bun:test';
import {
  absolute,
  connectionNode,
  groupPorts,
  ports,
  inherited,
  materialKey,
  newDocument,
  newNode,
  reparent,
  visibleNode,
  visibleConnections,
} from './model';
import { arrangeDocument } from './layout';

describe('factory sections', () => {
  test('node creation works without secure-context randomUUID', () => {
    const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const first = newNode('output').id;
      expect(first).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(newNode('output').id).not.toBe(first);
    } finally {
      if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor);
      else Reflect.deleteProperty(crypto, 'randomUUID');
    }
  });
  test('ELK arranges a nested recycling graph with relative child coordinates', async () => {
    const doc = newDocument('test'),
      group = newNode('group'),
      input = newNode('input', group.id),
      output = newNode('output', group.id);
    doc.nodes = [group, input, output];
    doc.connections = [
      {
        id: 'forward',
        source: input.id,
        target: output.id,
        sourcePort: '',
        targetPort: '',
        itemId: 'iron',
        availableLines: null,
        generated: false,
      },
      {
        id: 'recycle',
        source: output.id,
        target: input.id,
        sourcePort: '',
        targetPort: '',
        itemId: 'water',
        availableLines: null,
        generated: false,
      },
    ];
    const selfDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'self');
    Reflect.deleteProperty(globalThis, 'self');
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
    const elk = new ELK();
    if (selfDescriptor) Object.defineProperty(globalThis, 'self', selfDescriptor);
    const positions = await arrangeDocument(doc, elk);
    expect(Object.keys(positions).length).toBe(3);
    for (const n of [input, output]) {
      expect(positions[n.id].x).toBeGreaterThanOrEqual(0);
      expect(positions[n.id].y).toBeGreaterThanOrEqual(65);
      expect(positions[n.id].x + positions[n.id].width).toBeLessThanOrEqual(
        positions[group.id].width
      );
    }
  });
  test('reparenting preserves canvas coordinates and prevents hierarchy cycles', () => {
    const doc = newDocument('test');
    const group = newNode('group', '', 100, 200),
      child = newNode('output', '', 350, 400);
    doc.nodes = [group, child];
    const moved = reparent(doc, [child.id], group.id);
    expect(absolute(moved, child.id)).toEqual({ x: 350, y: 400 });
    expect(moved.nodes[1].x).toBe(250);
    expect(reparent(moved, [group.id], child.id).nodes[0].parentId).toBe('');
    const generated = { ...newNode('production', group.id, 30, 40), generated: true };
    moved.nodes.push(generated);
    expect(reparent(moved, [generated.id], '').nodes[2]).toEqual(generated);
    expect(reparent(moved, [child.id, generated.id], '').nodes[1].parentId).toBe('');
    expect(reparent(moved, [child.id, generated.id], '').nodes[2]).toEqual(generated);
  });
  test('outermost collapsed ancestor owns projected ports', () => {
    const doc = newDocument('test');
    const outer = { ...newNode('group'), collapsed: true },
      inner = { ...newNode('group', outer.id), collapsed: true },
      child = newNode('output', inner.id);
    doc.nodes = [outer, inner, child];
    expect(visibleNode(doc, child.id)).toBe(outer.id);
  });
  test('nearest ancestor wins for each policy independently', () => {
    const doc = newDocument('test'),
      outer = newNode('group'),
      inner = newNode('group', outer.id);
    doc.settings.recipes = [{ itemId: 'iron', recipeId: 'default', surplusRecipeId: 'residue' }];
    outer.settings.beltTier = 4;
    inner.settings.pipeTier = 2;
    inner.settings.recipes = [{ itemId: 'iron', recipeId: 'alternate', surplusRecipeId: '' }];
    doc.nodes = [outer, inner];
    expect(inherited(doc, inner.id)).toEqual({
      beltTier: 4,
      pipeTier: 2,
      recipes: [{ itemId: 'iron', recipeId: 'alternate', surplusRecipeId: '' }],
    });
    const moved = {
      ...doc,
      viewport: { x: 10, y: 20, zoom: 0.7 },
      nodes: doc.nodes.map((n) => ({ ...n, x: 500, collapsed: true })),
    };
    expect(materialKey(moved)).toBe(materialKey(doc));
  });
});

describe('authored changes', () => {
  test('GraphQL metadata and key ordering do not change document or material identity', async () => {
    const { documentKey } = await import('./model');
    const doc = newDocument('one');
    const fromGraphQL = {
      ...doc,
      __typename: 'PlannerDocument',
      viewport: { zoom: 1, y: 0, x: 0, __typename: 'PlannerViewport' },
    };
    expect(documentKey(fromGraphQL)).toBe(documentKey(doc));
    expect(documentKey({ ...doc, catalogVersion: 'two' })).toBe(documentKey(doc));
    expect(documentKey({ ...doc, name: 'Changed' })).not.toBe(documentKey(doc));
    expect(documentKey({ ...doc, viewport: { x: 400, y: 50, zoom: 0.5 } })).toBe(documentKey(doc));
  });
});

test('construction annotations retain material identity, required fixed rates do not', () => {
  const doc = newDocument('catalog');
  doc.nodes = [newNode('input')];
  const key = materialKey(doc);
  doc.nodes[0] = {
    ...doc.nodes[0],
    rate: 60,
    status: 'built',
    builtFingerprint: 'hash',
    name: 'Named input',
  };
  expect(materialKey(doc)).toBe(key);
  doc.nodes[0].inputRateMode = 'fixed';
  expect(materialKey(doc)).not.toBe(key);
});

test('new branch layout preserves established positions and aligns a simple chain', async () => {
  const { arrangeNewNodes } = await import('./layout');
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const before = newDocument('catalog');
  const output = newNode('output', '', 700, 200);
  before.nodes = [output];
  const doc = {
    ...before,
    nodes: [output, newNode('production'), newNode('production'), newNode('input')],
  };
  doc.connections = doc.nodes.slice(1).map((n, i) => ({
    id: String(i),
    source: n.id,
    target: doc.nodes[i].id,
    sourcePort: '',
    targetPort: '',
    itemId: 'item',
    availableLines: null,
    generated: true,
  }));
  const arranged = await arrangeNewNodes(doc, before, new ELK());
  expect(arranged.nodes[0]).toEqual(output);
  const production = arranged.nodes.filter((n) => n.kind === 'production');
  expect(production[0].y).toBe(production[1].y);
  expect(production[1].x).toBeLessThan(production[0].x);
});

test('material ports align across production, factory links, and collapsed sections', async () => {
  const { ports, groupPorts, portKey, portY, nodeDimensions } = await import('./model');
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const catalog = await Bun.file(
    `${import.meta.dir}/../../../../api/internal/planner/catalog.json`
  ).json();
  const doc = newDocument(catalog.version);
  const recipe = catalog.recipes.find(
    (r: { id: string }) => r.id === 'Recipe_SpaceElevatorPart_5_C'
  );
  const machine = {
    ...newNode('production'),
    itemId: recipe.products[0].itemId,
    recipeId: recipe.id,
    machineId: recipe.machineIds[0],
  };
  const sources = recipe.ingredients.map((a: { itemId: string }) => ({
    ...newNode('input'),
    itemId: a.itemId,
  }));
  doc.nodes = [...sources, machine];
  doc.connections = sources.map((n: typeof machine, i: number) => ({
    id: `edge-${i}`,
    source: n.id,
    target: machine.id,
    sourcePort: '',
    targetPort: '',
    itemId: n.itemId,
    availableLines: null,
    generated: true,
  }));
  const ps = ports(machine, catalog, []);
  expect(ps.filter((p) => !p.source)).toHaveLength(4);
  expect(ports(sources[0], catalog, []).every((p) => p.source)).toBe(true);
  expect(nodeDimensions(machine, catalog).height).toBeGreaterThan(portY(machine, 3) + 12);
  const positions = await arrangeDocument(doc, new ELK(), catalog);
  for (const n of sources) {
    expect(positions[n.id].x + positions[n.id].width).toBeLessThan(positions[machine.id].x);
  }
  const group = { ...newNode('group'), collapsed: true };
  doc.nodes = [
    ...sources.map((n: typeof machine) => ({ ...n, parentId: group.id })),
    machine,
    group,
  ];
  const projected = groupPorts(doc, group.id, catalog, []);
  expect(projected.filter((p) => p.source)).toHaveLength(4);
  expect(projected.filter((p) => !p.source)).toHaveLength(4);
  expect(new Set(projected.map(portKey)).size).toBe(8);
  const collapsed = await arrangeDocument(doc, new ELK(), catalog);
  expect(collapsed[group.id]).toBeDefined();
  expect(collapsed[sources[0].id]).toBeUndefined();
  expect(nodeDimensions(group, catalog, [], projected).height).toBeGreaterThan(
    portY(group, 3) + 12
  );
  const child = {
    id: 'child',
    sessionId: 's',
    revision: 1,
    calculationKey: '',
    updatedAt: '',
    document: { ...newDocument(''), nodes: sources },
  };
  const link = { ...newNode('link'), linkedDiagramId: child.id };
  expect(ports(link, catalog, [child]).filter((p) => !p.source)).toHaveLength(4);
});

test('crowded columns gain horizontal space while sections still contain their children', async () => {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new ELK();
  const doc = newDocument('test');
  const group = { ...newNode('group'), id: 'group' };
  const source = { ...newNode('input', group.id), id: 'source' };
  const targets = Array.from({ length: 10 }, (_, i) => ({
    ...newNode('output', group.id),
    id: `target-${i}`,
  }));
  doc.nodes = [group, source, ...targets];
  doc.connections = targets.map((target, i) => ({
    id: `edge-${i}`,
    source: source.id,
    target: target.id,
    itemId: 'iron',
    sourcePort: '',
    targetPort: '',
    availableLines: null,
    generated: false,
  }));
  const dense = await arrangeDocument(doc, elk);
  const simple = await arrangeDocument(
    { ...doc, nodes: [group, source, targets[0]], connections: [doc.connections[0]] },
    elk
  );
  const gap = (p: typeof dense) => p['target-0'].x - p.source.x - p.source.width;
  expect(gap(dense)).toBeGreaterThan(gap(simple) + 100);
  for (const target of targets)
    expect(dense[target.id].x + dense[target.id].width).toBeLessThanOrEqual(dense.group.width);
});

test('factory exports expose the same boundary port expanded, collapsed, and linked', async () => {
  const catalog = (await import('../../../../api/internal/planner/catalog.json')).default as any;
  const doc = newDocument(catalog.version);
  const group = newNode('group');
  const output = {
    ...newNode('output', group.id),
    itemId: 'Desc_Wire_C',
    exposed: true,
    outputRateMode: 'demand',
  };
  const privateOutput = { ...newNode('output', group.id), itemId: 'Desc_Cable_C' };
  doc.nodes = [group, output, privateOutput];
  const expected = [{ nodeId: output.id, portId: '', itemId: output.itemId, source: true }];
  expect(groupPorts(doc, group.id, catalog, [])).toEqual(expected);
  expect(connectionNode(doc, output.id, true)).toBe(group.id);
  expect(connectionNode(doc, output.id, false)).toBe(output.id);
  expect(ports(privateOutput, catalog, []).some((p) => p.source)).toBe(false);
  group.collapsed = true;
  expect(groupPorts(doc, group.id, catalog, [])).toEqual(expected);
  expect(connectionNode(doc, output.id, false)).toBe(group.id);
  const diagram = {
    id: 'child',
    sessionId: 's',
    revision: 1,
    calculationKey: '',
    updatedAt: '',
    document: doc,
  };
  const link = { ...newNode('link'), linkedDiagramId: diagram.id };
  expect(ports(link, catalog, [diagram])).toEqual([
    { ...expected[0], nodeId: link.id, portId: output.id },
  ]);
  const key = materialKey(doc);
  output.rate = 100;
  expect(materialKey(doc)).toBe(key);
  output.exposed = false;
  expect(materialKey(doc)).not.toBe(key);
});

test('collapsed ancestors retain incoming ports of nested factories', async () => {
  const catalog = (await import('../../../../api/internal/planner/catalog.json')).default as any;
  const outer = { ...newNode('group'), collapsed: true };
  const inner = newNode('group', outer.id);
  const input = { ...newNode('input', inner.id), itemId: 'Desc_Wire_C' };
  const source = { ...newNode('supply'), itemId: input.itemId };
  const doc = {
    ...newDocument(catalog.version),
    nodes: [outer, inner, input, source],
    connections: [
      {
        id: 'supply',
        source: source.id,
        target: input.id,
        itemId: input.itemId,
        sourcePort: '',
        targetPort: '',
        availableLines: null,
        generated: false,
      },
    ],
  };
  expect(connectionNode(doc, input.id, false)).toBe(outer.id);
  expect(groupPorts(doc, outer.id, catalog, [])).toEqual([
    { nodeId: input.id, portId: '', itemId: input.itemId, source: false },
  ]);
});

test('independent factories stack while their internal chains stay inside their bounds', async () => {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const catalog = (await import('../../../../api/internal/planner/catalog.json')).default as any;
  const doc = newDocument(catalog.version);
  const groupA = { ...newNode('group'), id: 'a' };
  const groupB = { ...newNode('group'), id: 'b' };
  const inputA = { ...newNode('input', 'a'), id: 'in-a', itemId: 'Desc_IronIngot_C' };
  const inputB = { ...newNode('input', 'b'), id: 'in-b', itemId: 'Desc_IronIngot_C' };
  const outA = {
    ...newNode('output', 'a'),
    id: 'out-a',
    itemId: 'Desc_IronIngot_C',
    exposed: true,
  };
  const outB = {
    ...newNode('output', 'b'),
    id: 'out-b',
    itemId: 'Desc_IronIngot_C',
    exposed: true,
  };
  const relay = { ...newNode('output'), id: 'relay', itemId: 'Desc_IronIngot_C', exposed: true };
  const target = { ...newNode('output'), id: 'target', itemId: 'Desc_IronIngot_C' };
  doc.nodes = [groupA, groupB, inputA, inputB, outA, outB, relay, target];
  doc.connections = [
    [inputA.id, outA.id],
    [inputB.id, outB.id],
    [outA.id, relay.id],
    [relay.id, target.id],
    [outB.id, target.id],
  ].map(([source, target], i) => ({
    id: String(i),
    source,
    target,
    sourcePort: '',
    targetPort: '',
    itemId: inputA.itemId,
    generated: false,
    availableLines: null,
  }));
  const positions = await arrangeDocument(doc, new ELK(), catalog);
  expect(positions.a.x).toBe(positions.b.x);
  expect(Math.abs(positions.a.y - positions.b.y)).toBeGreaterThanOrEqual(
    Math.min(positions.a.height, positions.b.height) + 55
  );
  expect(positions.relay.x).toBeGreaterThan(positions.a.x + positions.a.width);
  expect(positions.target.x).toBe(positions.relay.x);
  for (const n of [inputA, inputB, outA, outB]) {
    expect(positions[n.id].x).toBeGreaterThanOrEqual(40);
    expect(positions[n.id].y).toBeGreaterThanOrEqual(80);
    expect(positions[n.id].x + positions[n.id].width).toBeLessThanOrEqual(
      positions[n.parentId].width - 40
    );
  }
  const { sectionPortY, portY } = await import('./model');
  const arranged = { ...doc, nodes: doc.nodes.map((n) => ({ ...n, ...positions[n.id] })) };
  expect(
    sectionPortY(arranged, 'a', { nodeId: outA.id, portId: '', itemId: outA.itemId, source: true })
  ).toBe(positions[outA.id].y + portY(outA, 0));
  expect(ports(inputA, catalog, []).filter((p) => !p.source)).toHaveLength(1);
});

test('changing a boundary material keeps its settings and disconnects its old material', async () => {
  const { changeMaterial } = await import('./model');
  for (const kind of ['output', 'input', 'supply']) {
    const node = { ...newNode(kind, 'section'), itemId: 'iron', generated: true, rate: 120 };
    const doc = {
      ...newDocument('test'),
      nodes: [node],
      connections: [
        {
          id: 'incoming',
          source: 'a',
          target: node.id,
          itemId: 'iron',
          sourcePort: '',
          targetPort: '',
          generated: false,
          availableLines: null,
        },
        {
          id: 'outgoing',
          source: node.id,
          target: 'b',
          itemId: 'iron',
          sourcePort: '',
          targetPort: '',
          generated: true,
          availableLines: null,
        },
        {
          id: 'unrelated',
          source: 'a',
          target: 'b',
          itemId: 'copper',
          sourcePort: '',
          targetPort: '',
          generated: true,
          availableLines: null,
        },
      ],
    };
    expect(changeMaterial(doc, node.id, node.itemId)).toBe(doc);
    const updated = changeMaterial(doc, node.id, 'copper');
    expect(updated.nodes[0]).toEqual({ ...node, name: '', itemId: 'copper', generated: false });
    expect(updated.connections).toEqual([doc.connections[2]]);
    expect(doc.nodes[0].itemId).toBe('iron');
  }
});

test('outputs become built only when their entire connected production chain is built', async () => {
  const { builtOutputIds } = await import('./model');
  const first = { ...newNode('production'), id: 'first', status: 'planned' };
  const last = { ...newNode('production'), id: 'last', status: 'built' };
  const output = { ...newNode('output'), id: 'output', exposed: true };
  const relay = { ...newNode('output'), id: 'relay' };
  const empty = { ...newNode('output'), id: 'empty' };
  const doc = {
    ...newDocument('test'),
    nodes: [first, last, output, relay, empty],
    connections: [
      ['first', 'last'],
      ['last', 'output'],
      ['output', 'relay'],
    ].map(([source, target], i) => ({
      id: String(i),
      source,
      target,
      sourcePort: '',
      targetPort: '',
      itemId: 'iron',
      generated: true,
      availableLines: null,
    })),
  };
  expect([...builtOutputIds(doc, 'factory', [])]).toEqual([]);
  first.status = 'built';
  expect([...builtOutputIds(doc, 'factory', [])]).toEqual(['output', 'relay']);
  last.status = 'building';
  expect([...builtOutputIds(doc, 'factory', [])]).toEqual([]);
  expect(output.status).toBe('planned');
});

test('linked output completion follows the selected output and ignores unrelated buildings', async () => {
  const { builtOutputIds } = await import('./model');
  const producer = { ...newNode('production'), id: 'producer', status: 'built', itemId: 'iron' };
  const other = { ...newNode('production'), id: 'other', itemId: 'copper' };
  const exported = { ...newNode('output'), id: 'export', itemId: 'iron', exposed: true };
  const connection = {
    id: 'edge',
    source: producer.id,
    target: exported.id,
    sourcePort: '',
    targetPort: '',
    itemId: 'iron',
    generated: true,
    availableLines: null,
  };
  const child = {
    id: 'child',
    sessionId: 's',
    revision: 1,
    calculationKey: '',
    updatedAt: '',
    document: {
      ...newDocument('test'),
      nodes: [producer, other, exported],
      connections: [connection],
    },
  };
  const link = { ...newNode('link'), id: 'link', linkedDiagramId: child.id };
  const out = { ...newNode('output'), id: 'out', itemId: 'iron' };
  const doc = {
    ...newDocument('test'),
    nodes: [link, out],
    connections: [{ ...connection, source: link.id, sourcePort: exported.id, target: out.id }],
  };
  expect([...builtOutputIds(doc, 'parent', [child])]).toEqual(['out']);
  producer.status = 'planned';
  expect([...builtOutputIds(doc, 'parent', [child])]).toEqual([]);
  producer.status = 'built';
  doc.connections[0].sourcePort = 'missing';
  expect([...builtOutputIds(doc, 'parent', [child])]).toEqual([]);
});

test('inactive generated connections hide only for current resolved results', () => {
  const doc = newDocument('test');
  const edge = {
    id: 'idle',
    source: 'a',
    target: 'b',
    sourcePort: '',
    targetPort: '',
    itemId: 'iron',
    generated: true,
    availableLines: null,
  };
  doc.connections = [
    edge,
    { ...edge, id: 'active' },
    { ...edge, id: 'authored', generated: false },
    { ...edge, id: 'unknown' },
  ];
  const calculation = {
    resolved: true,
    diagramId: 'd',
    revision: 1,
    calculationKey: 'key',
    catalogVersion: 'test',
    workspaceRevision: 'w',
    nodes: [],
    diagnostics: [],
    connections: ['idle', 'active', 'authored'].map((id) => ({
      connectionId: id,
      rate: id === 'active' ? 10 : 0,
      tier: 1,
      capacity: 60,
      requiredLines: id === 'active' ? 1 : 0,
      scopeId: '',
    })),
  };
  expect(visibleConnections(doc, calculation, false).map((e) => e.id)).toEqual([
    'active',
    'authored',
    'unknown',
  ]);
  expect(visibleConnections(doc, calculation, true)).toEqual(doc.connections);
  expect(visibleConnections(doc, { ...calculation, resolved: false }, false)).toEqual(
    doc.connections
  );
  expect(visibleConnections(doc, undefined, false)).toEqual(doc.connections);
});

test('disabled outputs keep their rows and hide connections even while results are stale', () => {
  const catalog = {
    recipes: [
      {
        id: 'r',
        ingredients: [{ itemId: 'water', amount: 1 }],
        products: [
          { itemId: 'scrap', amount: 1 },
          { itemId: 'water', amount: 1 },
        ],
      },
    ],
  } as any;
  const node = { ...newNode('production'), id: 'scrap', recipeId: 'r', disabledOutputs: ['water'] };
  const p = ports(node, catalog, []);
  expect(p.filter((p) => p.itemId === 'water')).toEqual([
    { nodeId: 'scrap', portId: '', itemId: 'water', source: false },
    { nodeId: 'scrap', portId: '', itemId: 'water', source: true, disabled: true },
  ]);
  const doc = newDocument('Disabled water');
  doc.nodes = [node];
  doc.connections = [
    {
      id: 'water',
      source: 'scrap',
      target: 'alumina',
      itemId: 'water',
      sourcePort: '',
      targetPort: '',
      generated: false,
      availableLines: null,
    },
    {
      id: 'scrap',
      source: 'scrap',
      target: 'out',
      itemId: 'scrap',
      sourcePort: '',
      targetPort: '',
      generated: true,
      availableLines: null,
    },
  ];
  expect(visibleConnections(doc, undefined, true).map((e) => e.id)).toEqual(['scrap']);
  const enabled = { ...doc, nodes: [{ ...node, disabledOutputs: [] }] };
  expect(visibleConnections(enabled, undefined, true)).toEqual(doc.connections);
  expect(materialKey(doc)).not.toBe(materialKey(enabled));
});
