import { expect, test } from 'bun:test';
import catalogData from '../../../../api/internal/planner/catalog.json';
import type { PlannerCatalog } from '@/services/plannerApi';
import { newDocument, newNode } from './model';
import { nodeSearchIndex, searchNodes } from './search';

const catalog: PlannerCatalog = {
  ...catalogData,
  unlocks: [],
  syncError: '',
  items: catalogData.items.map((item) => ({ ...item, unavailable: false })),
  recipes: catalogData.recipes.map((recipe) => ({ ...recipe, unavailable: false })),
};
const document = newDocument(catalog.version);
const recipe = catalog.recipes.find((r) => r.id === 'Recipe_AluminaSolution_C')!;
const section = { ...newNode('group'), id: 'section', name: 'Aluminum works' };
const production = {
  ...newNode('production', section.id),
  id: 'production',
  name: 'Alumina line',
  recipeId: recipe.id,
  machineId: recipe.machineIds[0],
  itemId: recipe.products[0].itemId,
};
const input = { ...newNode('input'), id: 'input', itemId: 'Desc_Water_C' };
const output = { ...newNode('output'), id: 'output', itemId: recipe.products[0].itemId };
document.nodes = [section, production, input, output];
const find = (query: string) =>
  searchNodes(document, nodeSearchIndex(document, catalog, []), query);

test('search combines material, recipe, machine and node type names', () => {
  expect([...find('REFINERY production').matches]).toEqual(['production']);
  expect([...find('required input water').matches]).toEqual(['input']);
  expect([...find('factory output alumina').matches]).toEqual(['output']);
  expect([...find('Aluminum works').matches]).toEqual(['section']);
  expect([...find('alumina line').matches]).toEqual(['production']);
});

test('search covers recipe ingredients and every product, including residuals', () => {
  for (const material of [...recipe.ingredients, ...recipe.products]) {
    const name = catalog.items.find((i) => i.id === material.itemId)!.name;
    expect(find(name).matches.has('production')).toBe(true);
  }
  expect(find('water').matches.has('input')).toBe(true);
});

test('empty or unmatched search leaves every node unhighlighted', () => {
  for (const query of ['', '  ', '---', 'nonexistent material']) {
    expect(find(query).matches.size).toBe(0);
    expect(find(query).visible.size).toBe(0);
  }
});

test('hidden descendants highlight the outermost collapsed section without changing the document', () => {
  const outer = { ...newNode('group'), id: 'outer', collapsed: true };
  const nested = {
    ...document,
    nodes: [outer, { ...section, parentId: outer.id, collapsed: true }, production],
  };
  const before = JSON.stringify(nested);
  const results = searchNodes(nested, nodeSearchIndex(nested, catalog, []), 'refinery');
  expect([...results.matches]).toEqual(['production']);
  expect([...results.visible]).toEqual([['outer', 1]]);
  expect(JSON.stringify(nested)).toBe(before);
});
