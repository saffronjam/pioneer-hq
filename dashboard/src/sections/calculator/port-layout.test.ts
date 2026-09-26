import { expect, test } from 'bun:test';
import catalogData from '../../../../api/internal/planner/catalog.json';
import type { PlannerCatalog } from '@/services/plannerApi';
import { newDocument, newNode, portKey } from './model';
import { orderedNodePorts } from './port-layout';

const catalog: PlannerCatalog = {
  ...catalogData,
  syncError: '',
  items: catalogData.items.map((item) => ({ ...item, unavailable: false })),
  recipes: catalogData.recipes.map((recipe) => ({ ...recipe, unavailable: false })),
};
const recipe = catalog.recipes.find((r) => r.id === 'Recipe_AluminaSolution_C')!;

test('reorders inputs and outputs to reduce crossings without moving nodes or changing connections', () => {
  const doc = newDocument(catalog.version);
  const machine = {
    ...newNode('production'),
    id: 'refinery',
    itemId: recipe.products[0].itemId,
    recipeId: recipe.id,
    machineId: recipe.machineIds[0],
    x: 600,
    y: 150,
  };
  doc.nodes = [machine];
  for (const [source, amounts] of [
    [true, recipe.ingredients],
    [false, recipe.products],
  ] as const) {
    amounts.forEach((amount, i) => {
      const node = {
        ...newNode(source ? 'input' : 'output'),
        id: `${source}-${i}`,
        itemId: amount.itemId,
        x: source ? 0 : 1200,
        y: i === 0 ? 600 : 0,
      };
      doc.nodes.push(node);
      doc.connections.push({
        id: node.id,
        source: source ? node.id : machine.id,
        target: source ? machine.id : node.id,
        sourcePort: '',
        targetPort: '',
        itemId: amount.itemId,
        availableLines: null,
        generated: true,
      });
    });
  }
  const before = JSON.stringify(doc);
  const result = orderedNodePorts(doc, catalog, []);
  expect(
    result
      .get(machine.id)!
      .filter((p) => !p.source)
      .map((p) => p.itemId)
  ).toEqual(recipe.ingredients.map((a) => a.itemId).reverse());
  expect(
    result
      .get(machine.id)!
      .filter((p) => p.source)
      .map((p) => p.itemId)
  ).toEqual(recipe.products.map((a) => a.itemId).reverse());
  expect(JSON.stringify(doc)).toBe(before);
  expect(orderedNodePorts(doc, catalog, []).get(machine.id)).toEqual(result.get(machine.id));

  doc.nodes
    .filter((n) => n.id !== machine.id)
    .forEach((node) => {
      node.y = 600 - node.y;
    });
  const moved = orderedNodePorts(doc, catalog, []).get(machine.id)!;
  expect(moved.filter((p) => !p.source).map((p) => p.itemId)).toEqual(
    recipe.ingredients.map((a) => a.itemId)
  );
  expect(moved.filter((p) => p.source).map((p) => p.itemId)).toEqual(
    recipe.products.map((a) => a.itemId)
  );
  expect(new Set(moved.map(portKey))).toEqual(new Set(result.get(machine.id)!.map(portKey)));
});

test('disconnected ports keep their recipe order', () => {
  const doc = newDocument(catalog.version);
  const node = { ...newNode('production'), recipeId: recipe.id };
  doc.nodes = [node];
  expect(
    orderedNodePorts(doc, catalog, [])
      .get(node.id)!
      .map((p) => p.itemId)
  ).toEqual([...recipe.ingredients, ...recipe.products].map((a) => a.itemId));
});
