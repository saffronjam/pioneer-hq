import type { PlannerCatalog, PlannerDiagram, PlannerDocument } from '@/services/plannerApi';
import { groupPorts, ports, visibleNode } from './model';

const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const kinds: Record<string, string> = {
  production: 'production',
  input: 'required input',
  supply: 'input supply',
  output: 'output target factory output',
  group: 'group factory section subfactory',
  link: 'linked factory',
};

/** Searchable names and materials for every node, including collapsed section contents. */
export function nodeSearchIndex(
  document: PlannerDocument,
  catalog: PlannerCatalog,
  diagrams: PlannerDiagram[]
) {
  const items = new Map(catalog.items.map((item) => [item.id, item.name]));
  const machines = new Map(catalog.machines.map((machine) => [machine.id, machine.name]));
  const recipes = new Map(catalog.recipes.map((recipe) => [recipe.id, recipe]));
  return new Map(
    document.nodes.map((node) => {
      const recipe = recipes.get(node.recipeId);
      const materials =
        node.kind === 'group'
          ? groupPorts(document, node.id, catalog, diagrams)
          : ports(node, catalog, diagrams);
      return [
        node.id,
        normalize(
          [
            node.name,
            kinds[node.kind] ?? node.kind,
            items.get(node.itemId),
            machines.get(node.machineId),
            recipe?.name,
            recipe?.alternate ? 'alternate' : '',
            node.status === 'building' ? 'in progress' : node.status,
            node.kind === 'link'
              ? diagrams.find((d) => d.id === node.linkedDiagramId)?.document.name
              : '',
            ...materials.map((port) => items.get(port.itemId)),
          ]
            .filter(Boolean)
            .join(' ')
        ),
      ];
    })
  );
}

/** Matches all query words and projects hidden matches onto their visible section. */
export function searchNodes(document: PlannerDocument, index: Map<string, string>, query: string) {
  const words = normalize(query).split(' ').filter(Boolean);
  const matches = new Set<string>();
  const visible = new Map<string, number>();
  if (words.length) {
    for (const [id, text] of index) {
      if (!words.every((word) => text.includes(word))) continue;
      matches.add(id);
      const target = visibleNode(document, id);
      visible.set(target, (visible.get(target) ?? 0) + 1);
    }
  }
  return { matches, visible };
}
