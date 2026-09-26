import { describe, expect, test } from 'bun:test';
import catalog from '../../../../api/internal/planner/catalog.json';
import type {
  PlannerCalculation,
  PlannerDiagram,
  PlannerNode,
  PlannerWorkspace,
} from '@/services/plannerApi';
import { newDocument, newNode } from './model';
import { summaryScopes, summarizeFactory } from './summary';

const node = (id: string, kind: string, itemId: string, parentId = '') => ({
  ...newNode(kind, parentId),
  id,
  name: id,
  itemId,
});
const diagram = (
  id: string,
  nodes: PlannerNode[],
  connections: [string, string, string][] = []
): PlannerDiagram => ({
  id,
  sessionId: 'session',
  revision: 1,
  calculationKey: id,
  updatedAt: '',
  document: {
    ...newDocument(catalog.version),
    name: id,
    nodes,
    connections: connections.map(([source, target, itemId], i) => ({
      id: `${id}-${i}`,
      source,
      target,
      itemId,
      sourcePort: '',
      targetPort: '',
      availableLines: null,
      generated: false,
    })),
  },
});
const result = (
  nodeId: string,
  inputs: [string, number][] = [],
  outputs: [string, number][] = [],
  machines = 0
): PlannerCalculation['nodes'][number] => ({
  nodeId,
  inputs: inputs.map(([itemId, rate]) => ({ itemId, rate })),
  outputs: outputs.map(([itemId, rate]) => ({ itemId, rate })),
  machines,
  equivalentMachines: machines,
  utilization: 1,
  somersloops: 0,
  powerKnown: true,
  powerMin: machines * 4,
  powerMax: machines * 4,
  installedPowerMax: machines * 4,
  exportRate: 0,
  surplusRate: 0,
  fingerprint: '',
});
const calculation = (
  d: PlannerDiagram,
  nodes: PlannerCalculation['nodes'],
  rates: number[]
): PlannerCalculation => ({
  diagramId: d.id,
  calculationKey: d.calculationKey,
  revision: 1,
  catalogVersion: catalog.version,
  workspaceRevision: '1',
  resolved: true,
  nodes,
  diagnostics: [],
  connections: d.document.connections.map((e, i) => ({
    connectionId: e.id,
    rate: rates[i],
    tier: 1,
    capacity: 60,
    requiredLines: 1,
    scopeId: '',
  })),
});
const workspace = (
  diagrams: PlannerDiagram[],
  calculations: PlannerCalculation[]
): PlannerWorkspace => ({
  revision: '1',
  catalog: {
    ...catalog,
    syncError: '',
    items: catalog.items.map((i) => ({ ...i, unavailable: false })),
    recipes: catalog.recipes.map((r) => ({ ...r, unavailable: false })),
  },
  diagrams,
  calculations,
});
const ore = 'Desc_OreIron_C',
  ingot = 'Desc_IronIngot_C',
  plate = 'Desc_IronPlate_C';

describe('factory summaries', () => {
  test('scope boundaries remove internal transfers, retain residuals, and aggregate building costs', () => {
    const d = diagram(
      'root',
      [
        node('ore', 'input', ore),
        { ...node('smelt', 'production', ingot), machineId: 'Build_SmelterMk1_C' },
        node('section', 'group', ''),
        node('import', 'input', ingot, 'section'),
        { ...node('plates', 'production', plate, 'section'), machineId: 'Build_ConstructorMk1_C' },
        { ...node('export', 'output', plate, 'section'), exposed: true },
        node('out', 'output', plate),
      ],
      [
        ['ore', 'smelt', ore],
        ['smelt', 'import', ingot],
        ['import', 'plates', ingot],
        ['plates', 'export', plate],
        ['export', 'out', plate],
      ]
    );
    const c = calculation(
      d,
      [
        result('ore', [], [[ore, 60]]),
        result('smelt', [[ore, 60]], [[ingot, 75]], 2),
        result('import', [[ingot, 60]], [[ingot, 60]]),
        result('plates', [[ingot, 60]], [[plate, 40]], 2),
        result('export', [[plate, 40]], [[plate, 40]]),
        result('out', [[plate, 40]], [[plate, 40]]),
      ],
      [60, 60, 60, 40, 40]
    );
    const w = workspace([d], [c]);
    const scopes = summaryScopes(d, [d]);
    const all = summarizeFactory(w, d, scopes[0]);
    expect(all.complete).toBe(true);
    expect(all.inputs).toEqual([{ itemId: ore, rate: 60, residual: 0 }]);
    expect(all.outputs).toContainEqual({ itemId: ingot, rate: 0, residual: 15 });
    expect(all.outputs).toContainEqual({ itemId: plate, rate: 40, residual: 0 });
    const constructors = all.buildings.find((r) => r.machineId === 'Build_ConstructorMk1_C')!;
    expect(constructors.count).toBe(2);
    expect(constructors.cost).toContainEqual({ itemId: 'Desc_Cable_C', amount: 16 });
    const main = summarizeFactory(w, d, scopes[1]);
    expect(main.inputs).toContainEqual({ itemId: plate, rate: 40, residual: 0 });
    expect(main.outputs).toContainEqual({ itemId: ingot, rate: 60, residual: 15 });
    expect(main.buildings.length).toBe(1);
    const section = summarizeFactory(w, d, scopes[2]);
    expect(section.inputs).toEqual([{ itemId: ingot, rate: 60, residual: 0 }]);
    expect(section.outputs).toEqual([{ itemId: plate, rate: 40, residual: 0 }]);
    expect(section.buildings[0].count).toBe(2);
  });

  test('multiple links to a physical factory do not duplicate its buildings or boundary flows', () => {
    const child = diagram(
      'child',
      [
        node('ore', 'input', ore),
        { ...node('smelt', 'production', ingot), machineId: 'Build_SmelterMk1_C' },
        { ...node('out', 'output', ingot), exposed: true },
      ],
      [
        ['ore', 'smelt', ore],
        ['smelt', 'out', ingot],
      ]
    );
    const root = diagram(
      'root',
      [
        { ...node('link-a', 'link', ''), linkedDiagramId: child.id },
        { ...node('link-b', 'link', ''), linkedDiagramId: child.id },
        node('a', 'output', ingot),
        node('b', 'output', ingot),
      ],
      [
        ['link-a', 'a', ingot],
        ['link-b', 'b', ingot],
      ]
    );
    const w = workspace(
      [root, child],
      [
        calculation(
          root,
          [result('a', [[ingot, 10]], [[ingot, 10]]), result('b', [[ingot, 20]], [[ingot, 20]])],
          [10, 20]
        ),
        calculation(
          child,
          [
            result('ore', [], [[ore, 30]]),
            result('smelt', [[ore, 30]], [[ingot, 30]], 1),
            result('out', [[ingot, 30]], [[ingot, 30]]),
          ],
          [30, 30]
        ),
      ]
    );
    const scopes = summaryScopes(root, w.diagrams);
    expect(scopes.filter((s) => s.diagramId === child.id).length).toBe(1);
    const all = summarizeFactory(w, root, scopes[0]);
    expect(all.inputs).toEqual([{ itemId: ore, rate: 30, residual: 0 }]);
    expect(all.outputs).toEqual([{ itemId: ingot, rate: 30, residual: 0 }]);
    expect(all.buildings[0].count).toBe(1);
    expect(summarizeFactory(w, root, scopes[1]).inputs).toEqual([
      { itemId: ingot, rate: 30, residual: 0 },
    ]);
    w.calculations[1].calculationKey = 'stale';
    expect(summarizeFactory(w, root, scopes[0]).complete).toBe(false);
  });

  test('fixed external supply includes unused residual and liquid units retain their quantities', () => {
    const d = diagram(
      'root',
      [
        { ...node('water', 'supply', 'Desc_Water_C'), fixedSupply: true, rate: 90 },
        node('out', 'output', 'Desc_Water_C'),
      ],
      [['water', 'out', 'Desc_Water_C']]
    );
    const c = calculation(
      d,
      [
        result('water', [], [['Desc_Water_C', 60]]),
        result('out', [['Desc_Water_C', 60]], [['Desc_Water_C', 60]]),
      ],
      [60]
    );
    c.diagnostics.push({
      diagramId: d.id,
      nodeId: 'water',
      connectionId: '',
      code: 'surplus',
      message: '',
      itemId: 'Desc_Water_C',
      rate: 30,
    });
    const w = workspace([d], [c]);
    const summary = summarizeFactory(w, d, summaryScopes(d, [d])[0]);
    expect(summary.inputs[0].rate).toBe(90);
    expect(summary.outputs).toEqual([{ itemId: 'Desc_Water_C', rate: 60, residual: 30 }]);
  });
});
