import { expect, test } from 'bun:test';
import ELK from 'elkjs/lib/elk.bundled.js';
import { arrangeDocument, arrangeNewNodes } from './layout';
import { newDocument, newNode } from './model';

const createElk = () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Reflect.deleteProperty(globalThis, 'self');
  try {
    return new ELK();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'self', descriptor);
  }
};

test('all sources and targets occupy separate outer columns across disconnected and unequal chains', async () => {
  const d = newDocument('test');
  const a = { ...newNode('input'), id: 'a' },
    b = { ...newNode('supply'), id: 'b' },
    c = { ...newNode('input'), id: 'c' };
  const p = { ...newNode('production'), id: 'p' },
    q = { ...newNode('production'), id: 'q' };
  const x = { ...newNode('output'), id: 'x' },
    y = { ...newNode('output'), id: 'y' },
    z = { ...newNode('output'), id: 'z' };
  d.nodes = [a, b, c, p, q, x, y, z];
  d.connections = [
    ['a', 'p'],
    ['p', 'q'],
    ['q', 'x'],
    ['b', 'y'],
  ].map(([source, target], i) => ({
    id: String(i),
    source,
    target,
    sourcePort: '',
    targetPort: '',
    itemId: 'iron',
    availableLines: null,
    generated: false,
  }));
  const positions = await arrangeDocument(d, createElk());
  expect(new Set([a, b, c].map((n) => positions[n.id].x)).size).toBe(1);
  expect(new Set([x, y, z].map((n) => positions[n.id].x)).size).toBe(1);
  expect(positions.a.x + positions.a.width).toBeLessThan(positions.p.x);
  expect(positions.x.x).toBeGreaterThan(positions.q.x + positions.q.width);
  for (const column of [
    [a, b, c],
    [x, y, z],
  ]) {
    const cards = column.map((n) => positions[n.id]).sort((a, b) => a.y - b.y);
    for (let i = 1; i < cards.length; i++)
      expect(cards[i].y).toBeGreaterThan(cards[i - 1].y + cards[i - 1].height);
  }
  const before = {
    ...d,
    nodes: d.nodes.filter((n) => n.id !== 'c').map((n) => ({ ...n, ...positions[n.id] })),
  };
  const after = await arrangeNewNodes(
    { ...before, nodes: [...before.nodes, c] },
    before,
    createElk()
  );
  expect(
    new Set(after.nodes.filter((n) => ['input', 'supply'].includes(n.kind)).map((n) => n.x)).size
  ).toBe(1);
});

test('growing a nested section keeps its outputs and the parent outputs beyond the new contents', async () => {
  const group = { ...newNode('group', '', 300, 0), id: 'section', width: 350, height: 250 };
  const child = { ...newNode('output', group.id, 100, 80), id: 'child' };
  const input = { ...newNode('input', '', 0, 0), id: 'input' };
  const output = { ...newNode('output', '', 800, 0), id: 'output' };
  const before = { ...newDocument('test'), nodes: [group, child, input, output] };
  const added = { ...newNode('production', group.id, 700, 80), id: 'added' };
  const after = await arrangeNewNodes(
    { ...before, nodes: [...before.nodes, added] },
    before,
    createElk()
  );
  const get = (id: string) => after.nodes.find((n) => n.id === id)!;
  expect(get('child').x).toBeGreaterThan(get('added').x + get('added').width);
  expect(get('output').x).toBeGreaterThan(get('section').x + get('section').width);
  expect(get('input').x + get('input').width).toBeLessThan(get('section').x);
});

test('production without ingredients joins the first production column unless that column needs it', async () => {
  const d = newDocument('test');
  d.nodes = ['input', 'first', 'second', 'free', 'output'].map((id) => ({
    ...newNode(id === 'input' || id === 'output' ? id : 'production'),
    id,
  }));
  const edges = [
    ['input', 'first'],
    ['first', 'second'],
    ['second', 'output'],
    ['free', 'second'],
  ];
  const connect = () =>
    edges.map(([source, target], i) => ({
      id: String(i),
      source,
      target,
      sourcePort: '',
      targetPort: '',
      itemId: 'iron',
      availableLines: null,
      generated: false,
    }));
  d.connections = connect();
  const joined = await arrangeDocument(d, createElk());
  expect(joined.free.x).toBe(joined.first.x);
  expect(joined.free.x).toBeGreaterThan(joined.input.x);
  expect(joined.second.x).toBeGreaterThan(joined.free.x);
  edges[3] = ['free', 'first'];
  d.connections = connect();
  const separate = await arrangeDocument(d, createElk());
  expect(separate.free.x).toBeLessThan(separate.first.x);
});
