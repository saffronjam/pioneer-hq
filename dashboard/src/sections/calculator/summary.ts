import type { PlannerDiagram, PlannerWorkspace, PlannerNode } from '@/services/plannerApi';
import { ancestors } from './model';

export type SummaryScope = { id: string; name: string; diagramId: string; groupId?: string };
export type MaterialSummary = { itemId: string; rate: number; residual: number };
export type BuildingSummary = {
  machineId: string;
  count: number;
  powerMin: number;
  powerMax: number;
  peak: number;
  powerKnown: boolean;
  costKnown: boolean;
  cost: { itemId: string; amount: number }[];
};

/** Scopes reachable from a diagram, with each linked physical factory listed once. */
export function summaryScopes(root: PlannerDiagram, diagrams: PlannerDiagram[]): SummaryScope[] {
  const scopes: SummaryScope[] = [
    { id: 'all', name: 'All', diagramId: root.id },
    { id: 'main', name: 'Main', diagramId: root.id },
  ];
  const visited = new Set<string>();
  const visit = (diagram: PlannerDiagram, prefix: string) => {
    if (visited.has(diagram.id)) return;
    visited.add(diagram.id);
    const groups = diagram.document.nodes.filter((n) => n.kind === 'group');
    for (const n of groups) {
      const path = [...ancestors(diagram.document, n.id)]
        .reverse()
        .map((id) => groups.find((g) => g.id === id)?.name);
      scopes.push({
        id: `${diagram.id}/${n.id}`,
        name: [prefix, ...path, n.name].filter(Boolean).join(' / '),
        diagramId: diagram.id,
        groupId: n.id,
      });
    }
    for (const n of diagram.document.nodes.filter((n) => n.kind === 'link')) {
      const linked = diagrams.find((d) => d.id === n.linkedDiagramId);
      if (!linked || visited.has(linked.id)) continue;
      scopes.push({ id: `linked/${linked.id}`, name: linked.document.name, diagramId: linked.id });
      visit(linked, linked.document.name);
    }
  };
  visit(root, '');
  return scopes;
}

/** Aggregates calculated flows across a scope boundary and counts physical buildings once. */
export function summarizeFactory(
  workspace: PlannerWorkspace,
  root: PlannerDiagram,
  scope: SummaryScope
) {
  const diagrams = new Map(workspace.diagrams.map((d) => [d.id, d]));
  diagrams.set(root.id, root);
  const calculations = new Map(workspace.calculations.map((c) => [c.diagramId, c]));
  const included = new Set<string>();
  const visited = new Set<string>();
  const collect = (id: string, filter: (n: PlannerNode) => boolean) => {
    const d = diagrams.get(id);
    if (!d || visited.has(id)) return;
    visited.add(id);
    for (const n of d.document.nodes.filter(filter)) {
      if (n.kind === 'link') {
        if (scope.id !== 'main') collect(n.linkedDiagramId, () => true);
      } else if (n.kind !== 'group') included.add(`${id}/${n.id}`);
    }
  };
  const selected = diagrams.get(scope.diagramId)!;
  collect(scope.diagramId, (n) =>
    scope.id === 'main'
      ? !n.parentId
      : !scope.groupId || ancestors(selected.document, n.id).includes(scope.groupId)
  );
  const edgeFlows: { source: string; target: string; itemId: string; rate: number }[] = [];
  const endpoint = (
    d: PlannerDiagram,
    id: string,
    portId: string,
    itemId: string,
    source: boolean
  ) => {
    const n = d.document.nodes.find((n) => n.id === id);
    if (n?.kind !== 'link') return `${d.id}/${id}`;
    const matches =
      diagrams
        .get(n.linkedDiagramId)
        ?.document.nodes.filter(
          (v) =>
            v.kind === (source ? 'output' : 'input') &&
            (!source || v.exposed) &&
            v.itemId === itemId &&
            (!portId || portId === v.id)
        ) ?? [];
    return matches.length === 1 ? `${n.linkedDiagramId}/${matches[0].id}` : '';
  };
  for (const d of diagrams.values()) {
    const rates = new Map(calculations.get(d.id)?.connections.map((r) => [r.connectionId, r.rate]));
    for (const e of d.document.connections)
      edgeFlows.push({
        source: endpoint(d, e.source, e.sourcePort, e.itemId, true),
        target: endpoint(d, e.target, e.targetPort, e.itemId, false),
        itemId: e.itemId,
        rate: rates.get(e.id) ?? 0,
      });
  }
  const inputs = new Map<string, MaterialSummary>();
  const outputs = new Map<string, MaterialSummary>();
  const buildings = new Map<string, BuildingSummary>();
  const add = (map: Map<string, MaterialSummary>, itemId: string, rate: number, residual = 0) => {
    if (rate < 1e-6 && residual < 1e-6) return;
    const row = map.get(itemId) ?? { itemId, rate: 0, residual: 0 };
    row.rate += Math.max(0, rate);
    row.residual += Math.max(0, residual);
    map.set(itemId, row);
  };
  let complete = true;
  for (const d of diagrams.values()) {
    const c = calculations.get(d.id);
    const results = new Map(c?.nodes.map((r) => [r.nodeId, r]));
    for (const n of d.document.nodes) {
      const key = `${d.id}/${n.id}`;
      if (!included.has(key)) continue;
      const r = results.get(n.id);
      if (!r || !c?.resolved || c.calculationKey !== d.calculationKey) {
        complete = false;
        continue;
      }
      const incoming = edgeFlows.filter((e) => e.target === key);
      const outgoing = edgeFlows.filter((e) => e.source === key);
      const sum = (edges: typeof edgeFlows, itemId: string) =>
        edges.filter((e) => e.itemId === itemId).reduce((s, e) => s + e.rate, 0);
      let needs = r.inputs;
      if (n.kind === 'input' || n.kind === 'supply') {
        const demand = sum(outgoing, n.itemId);
        needs = [
          {
            itemId: n.itemId,
            rate:
              n.inputRateMode === 'fixed' || (n.kind === 'supply' && n.fixedSupply)
                ? Math.max(n.rate, demand)
                : demand,
          },
        ];
      }
      for (const f of needs)
        add(
          inputs,
          f.itemId,
          f.rate -
            sum(
              incoming.filter((e) => included.has(e.source)),
              f.itemId
            )
        );
      if (n.kind === 'output') {
        for (const f of r.outputs)
          add(
            outputs,
            f.itemId,
            f.rate -
              sum(
                outgoing.filter((e) => included.has(e.target)),
                f.itemId
              )
          );
      } else {
        for (const e of outgoing.filter((e) => !included.has(e.target)))
          add(outputs, e.itemId, e.rate);
        if (n.kind === 'production') {
          for (const f of r.outputs) add(outputs, f.itemId, 0, f.rate - sum(outgoing, f.itemId));
        } else {
          for (const diagnostic of c.diagnostics.filter(
            (v) => v.nodeId === n.id && v.code === 'surplus'
          ))
            add(outputs, diagnostic.itemId, 0, diagnostic.rate);
        }
      }
      if (n.kind === 'production' && r.machines > 0) {
        const machine = workspace.catalog.machines.find((m) => m.id === n.machineId);
        const row = buildings.get(n.machineId) ?? {
          machineId: n.machineId,
          count: 0,
          powerMin: 0,
          powerMax: 0,
          peak: 0,
          powerKnown: true,
          costKnown: !!machine?.buildCost.length,
          cost: [],
        };
        row.count += r.machines;
        row.powerMin += r.powerMin;
        row.powerMax += r.powerMax;
        row.peak += r.installedPowerMax;
        row.powerKnown &&= r.powerKnown;
        row.cost = (machine?.buildCost ?? []).map((a) => ({ ...a, amount: a.amount * row.count }));
        buildings.set(n.machineId, row);
      }
    }
  }
  const itemName = (id: string) => workspace.catalog.items.find((i) => i.id === id)?.name ?? id;
  const sorted = (map: Map<string, MaterialSummary>) =>
    [...map.values()].sort((a, b) => itemName(a.itemId).localeCompare(itemName(b.itemId)));
  return {
    inputs: sorted(inputs),
    outputs: sorted(outputs),
    complete,
    buildings: [...buildings.values()].sort((a, b) =>
      (
        workspace.catalog.machines.find((m) => m.id === a.machineId)?.name ?? a.machineId
      ).localeCompare(
        workspace.catalog.machines.find((m) => m.id === b.machineId)?.name ?? b.machineId
      )
    ),
  };
}
