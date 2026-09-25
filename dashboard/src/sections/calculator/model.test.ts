import { describe, expect, test } from 'bun:test';
import {
  absolute,
  inherited,
  materialKey,
  newDocument,
  newNode,
  reparent,
  visibleNode,
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
      },
      {
        id: 'recycle',
        source: output.id,
        target: input.id,
        sourcePort: '',
        targetPort: '',
        itemId: 'water',
        availableLines: null,
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
    doc.settings.recipes = [{ itemId: 'iron', recipeId: 'default' }];
    outer.settings.beltTier = 4;
    inner.settings.pipeTier = 2;
    inner.settings.recipes = [{ itemId: 'iron', recipeId: 'alternate' }];
    doc.nodes = [outer, inner];
    expect(inherited(doc, inner.id)).toEqual({
      beltTier: 4,
      pipeTier: 2,
      recipes: [{ itemId: 'iron', recipeId: 'alternate' }],
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
    const { documentKey, sameViewport } = await import('./model');
    const doc = newDocument('one');
    const fromGraphQL = {
      ...doc,
      __typename: 'PlannerDocument',
      viewport: { zoom: 1, y: 0, x: 0, __typename: 'PlannerViewport' },
    };
    expect(documentKey(fromGraphQL)).toBe(documentKey(doc));
    expect(sameViewport(fromGraphQL.viewport, doc.viewport)).toBe(true);
    expect(documentKey({ ...doc, catalogVersion: 'two' })).toBe(documentKey(doc));
    expect(documentKey({ ...doc, name: 'Changed' })).not.toBe(documentKey(doc));
    expect(sameViewport(doc.viewport, { x: 1, y: 0, zoom: 1 })).toBe(false);
    expect(sameViewport(doc.viewport, { x: 0, y: 0, zoom: 1.2 })).toBe(false);
  });
});
