import type {
  PlannerCatalog,
  PlannerCalculation,
  PlannerDiagram,
  PlannerDocument,
  PlannerNode,
  PlannerWorkspace,
} from '@/services/plannerApi';

export const settings = () => ({ recipes: [], beltTier: 0, pipeTier: 0 });
export const uid = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export const number = (v: number, maximumFractionDigits = 2) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(v);

export function newDocument(version: string): PlannerDocument {
  return {
    version: 1,
    name: 'Untitled factory',
    description: '',
    catalogVersion: version,
    settings: { ...settings(), beltTier: 1, pipeTier: 1 },
    nodes: [],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function newNode(kind: string, parentId = '', x = 0, y = 0): PlannerNode {
  return {
    id: uid(),
    kind,
    parentId,
    name: kind === 'group' ? 'Factory section' : '',
    itemId: '',
    recipeId: '',
    machineId: '',
    linkedDiagramId: '',
    x,
    y,
    width: kind === 'group' ? 800 : 250,
    height: kind === 'group' ? 500 : 180,
    collapsed: false,
    rate: 0,
    inputRateMode: 'calculated',
    outputRateMode: 'fixed',
    exposed: false,
    clock: 100,
    somersloops: 0,
    status: 'planned',
    generated: false,
    surplus: false,
    disabledOutputs: [],
    fixedSupply: false,
    settings: settings(),
    builtFingerprint: '',
  };
}

export function ancestors(doc: PlannerDocument, id: string): string[] {
  const result: string[] = [];
  let node = doc.nodes.find((n) => n.id === id);
  while (node?.parentId && !result.includes(node.parentId)) {
    result.push(node.parentId);
    node = doc.nodes.find((n) => n.id === node?.parentId);
  }
  return result;
}

export function absolute(doc: PlannerDocument, id: string) {
  const n = doc.nodes.find((n) => n.id === id);
  return ancestors(doc, id).reduce(
    (pos, p) => {
      const parent = doc.nodes.find((n) => n.id === p)!;
      return { x: pos.x + parent.x, y: pos.y + parent.y };
    },
    { x: n?.x ?? 0, y: n?.y ?? 0 }
  );
}

/** Changes an authored material boundary and removes connections for its old material. */
export function changeMaterial(
  doc: PlannerDocument,
  nodeId: string,
  itemId: string
): PlannerDocument {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node || !['input', 'output', 'supply'].includes(node.kind) || node.itemId === itemId)
    return doc;
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId ? { ...n, itemId, name: '', generated: false } : n
    ),
    connections: doc.connections.filter((e) => e.source !== nodeId && e.target !== nodeId),
  };
}

export function reparent(doc: PlannerDocument, ids: string[], parentId: string): PlannerDocument {
  const parent = absolute(doc, parentId);
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (
        n.generated ||
        !ids.includes(n.id) ||
        n.id === parentId ||
        ancestors(doc, parentId).includes(n.id)
      )
        return n;
      const pos = absolute(doc, n.id);
      return { ...n, parentId, x: pos.x - parent.x, y: pos.y - parent.y };
    }),
  };
}

export function visibleNode(doc: PlannerDocument, id: string) {
  return (
    ancestors(doc, id)
      .reverse()
      .find((p) => doc.nodes.find((n) => n.id === p)?.collapsed) ?? id
  );
}

/** Projects declared factory ports onto their enclosing section boundary. */
export function connectionNode(doc: PlannerDocument, id: string, source: boolean) {
  const n = doc.nodes.find((n) => n.id === id);
  if (
    n?.parentId &&
    ((source && n.kind === 'output' && n.exposed) || (!source && n.kind === 'input'))
  )
    return visibleNode(doc, n.parentId);
  return visibleNode(doc, id);
}

export type Port = {
  nodeId: string;
  portId: string;
  itemId: string;
  source: boolean;
  disabled?: boolean;
};
export const portKey = (p: Port) => JSON.stringify([p.nodeId, p.portId, p.itemId, p.source]);
export function parsePort(key?: string | null): Port | null {
  if (!key) return null;
  try {
    const [nodeId, portId, itemId, source] = JSON.parse(key);
    return { nodeId, portId, itemId, source };
  } catch {
    return null;
  }
}

export function ports(
  node: PlannerNode,
  catalog: PlannerCatalog,
  diagrams: PlannerDiagram[]
): Port[] {
  if (node.kind === 'link') {
    return (diagrams.find((d) => d.id === node.linkedDiagramId)?.document.nodes ?? [])
      .filter((n) => n.kind === 'input' || (n.kind === 'output' && n.exposed))
      .map((n) => ({
        nodeId: node.id,
        portId: n.id,
        itemId: n.itemId,
        source: n.kind === 'output',
      }));
  }
  if (node.kind === 'production') {
    const recipe = catalog.recipes.find((r) => r.id === node.recipeId);
    return [
      ...(recipe?.ingredients ?? []).map((a) => ({
        nodeId: node.id,
        portId: '',
        itemId: a.itemId,
        source: false,
      })),
      ...(recipe?.products ?? []).map((a) => ({
        nodeId: node.id,
        portId: '',
        itemId: a.itemId,
        source: true,
        disabled: node.disabledOutputs?.includes(a.itemId),
      })),
    ];
  }
  if (node.kind === 'group') return [];
  return (
    node.kind === 'output'
      ? node.exposed
        ? [false, true]
        : [false]
      : node.kind === 'input' && node.parentId
        ? [false, true]
        : [true]
  ).map((source) => ({
    nodeId: node.id,
    portId: '',
    itemId: node.itemId,
    source,
  }));
}

/** Aligns a section boundary port with the material node inside it. */
export function sectionPortY(doc: PlannerDocument, groupId: string, p: Port) {
  const child = doc.nodes.find((n) => n.id === p.nodeId);
  if (!child) return 74;
  return absolute(doc, child.id).y - absolute(doc, groupId).y + portY(child, 0);
}

export function groupPorts(
  doc: PlannerDocument,
  groupId: string,
  catalog: PlannerCatalog,
  diagrams: PlannerDiagram[]
) {
  const inside = new Set(
    doc.nodes.filter((n) => ancestors(doc, n.id).includes(groupId)).map((n) => n.id)
  );
  const result: Port[] = doc.nodes
    .filter(
      (n) => n.parentId === groupId && (n.kind === 'input' || (n.kind === 'output' && n.exposed))
    )
    .map((n) => ({ nodeId: n.id, portId: '', itemId: n.itemId, source: n.kind === 'output' }));
  if (!doc.nodes.find((n) => n.id === groupId)?.collapsed) return result;
  for (const n of doc.nodes.filter((n) => inside.has(n.id))) {
    for (const p of ports(n, catalog, diagrams)) {
      const edges = doc.connections.filter((e) =>
        p.source
          ? e.source === n.id && e.itemId === p.itemId && e.sourcePort === p.portId
          : e.target === n.id && e.itemId === p.itemId && e.targetPort === p.portId
      );
      if (
        edges.some((e) => !inside.has(p.source ? e.target : e.source)) &&
        !result.some((q) => portKey(p) === portKey(q))
      )
        result.push(p);
    }
  }
  return result;
}

export function inherited(doc: PlannerDocument, scope: string) {
  const chain = [
    doc.settings,
    ...[...ancestors(doc, scope).reverse(), scope]
      .filter(Boolean)
      .map((id) => doc.nodes.find((n) => n.id === id)!.settings),
  ];
  return chain.reduce(
    (acc, s) => ({
      beltTier: s.beltTier || acc.beltTier,
      pipeTier: s.pipeTier || acc.pipeTier,
      recipes: [
        ...acc.recipes.filter((r) => !s.recipes.some((v) => v.itemId === r.itemId)),
        ...s.recipes,
      ],
    }),
    {
      ...settings(),
      recipes: [] as PlannerDocument['settings']['recipes'],
      beltTier: 1,
      pipeTier: 1,
    }
  );
}

/** Mathematical inputs, independent of authored layout and construction annotations. */
export function materialKey(doc: PlannerDocument) {
  return documentKey({
    settings: doc.settings,
    nodes: doc.nodes
      .map(
        ({
          x: _x,
          y: _y,
          width: _w,
          height: _h,
          collapsed: _c,
          name: _n,
          status: _s,
          builtFingerprint: _b,
          generated: _g,
          ...n
        }) => ({
          ...n,
          rate:
            (n.kind === 'input' && n.inputRateMode !== 'fixed') ||
            (n.kind === 'output' && n.outputRateMode === 'demand')
              ? 0
              : n.rate,
        })
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
    connections: doc.connections
      .map(({ generated: _g, ...e }) => e)
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

/** Outputs whose connected upstream production buildings are all built. */
export function builtOutputIds(
  doc: PlannerDocument,
  diagramId: string,
  diagrams: PlannerDiagram[]
) {
  const documents = new Map(diagrams.map((d) => [d.id, d.document]));
  documents.set(diagramId, doc);
  const nodes = new Map<string, PlannerNode>(
    [...documents].flatMap(([id, d]) => d.nodes.map((n) => [`${id}/${n.id}`, n] as const))
  );
  const incoming = new Map<string, (string | null)[]>();
  const endpoint = (
    id: string,
    nodeId: string,
    portId: string,
    itemId: string,
    source: boolean
  ) => {
    const key = `${id}/${nodeId}`;
    const node = nodes.get(key);
    if (node?.kind !== 'link') return nodes.has(key) ? key : null;
    const matches =
      documents
        .get(node.linkedDiagramId)
        ?.nodes.filter(
          (n) =>
            n.itemId === itemId &&
            (portId === '' || n.id === portId) &&
            (source ? n.kind === 'output' && n.exposed : n.kind === 'input')
        ) ?? [];
    return matches.length === 1 ? `${node.linkedDiagramId}/${matches[0].id}` : null;
  };
  for (const [id, document] of documents) {
    for (const edge of document.connections) {
      const source = endpoint(id, edge.source, edge.sourcePort, edge.itemId, true);
      const target = endpoint(id, edge.target, edge.targetPort, edge.itemId, false);
      if (target) incoming.set(target, [...(incoming.get(target) ?? []), source]);
    }
  }
  const built = new Set<string>();
  for (const output of doc.nodes.filter((n) => n.kind === 'output')) {
    const visited = new Set<string>();
    let production = 0,
      complete = true;
    const visit = (key: string | null) => {
      if (!key) {
        complete = false;
        return;
      }
      if (visited.has(key)) return;
      visited.add(key);
      const node = nodes.get(key)!;
      if (node.kind === 'production') {
        production++;
        complete &&= node.status === 'built';
      }
      for (const source of incoming.get(key) ?? []) visit(source);
    };
    visit(`${diagramId}/${output.id}`);
    if (production > 0 && complete) built.add(output.id);
  }
  return built;
}

/** Whether a node describes physical construction work. */
export const buildable = (n: PlannerNode) => ['production', 'group', 'link'].includes(n.kind);

/** Stable authored content, independent of GraphQL metadata and object key order. */
export function documentKey(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .filter(([k]) => k !== '__typename' && k !== 'catalogVersion' && k !== 'viewport')
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, normalize(val)])
      );
    return v;
  };
  return JSON.stringify(normalize(value));
}

/** Dimensions shared by rendered cards and graph layout. */
export function nodeDimensions(
  n: PlannerNode,
  catalog?: PlannerCatalog,
  diagrams: PlannerDiagram[] = [],
  nodePorts = catalog ? ports(n, catalog, diagrams) : []
) {
  if (n.kind === 'group' && !n.collapsed)
    return {
      width: n.width,
      height: Math.max(
        n.height,
        72 +
          Math.max(
            nodePorts.filter((p) => p.source).length,
            nodePorts.filter((p) => !p.source).length
          ) *
            24
      ),
    };
  return {
    width: !buildable(n) ? 250 : 320,
    height: !buildable(n)
      ? n.kind === 'output' && n.exposed
        ? 120
        : 96
      : portRowsTop(n) +
        Math.max(
          1,
          nodePorts.filter((p) => p.source).length,
          nodePorts.filter((p) => !p.source).length
        ) *
          24 +
        8,
  };
}

/** Offset of the material rows shared by node rendering and port-aware layout. */
export function portRowsTop(n: PlannerNode) {
  return n.kind === 'production' ? 100 : 52;
}

/** Vertical center of a material connection in its node. */
export function portY(n: PlannerNode, index: number) {
  return !buildable(n) ? 74 : portRowsTop(n) + index * 24 + 12;
}

/** Refreshes construction annotations using the server's material fingerprints. */
export function refreshBuildWarnings(workspace: PlannerWorkspace): PlannerWorkspace {
  const calculations = workspace.calculations.map((c) => {
    const d = workspace.diagrams.find((d) => d.id === c.diagramId);
    if (!d || c.calculationKey !== d.calculationKey) return c;
    const diagnostics = c.diagnostics.filter(
      (d) => !['built_changed', 'linked_warning'].includes(d.code)
    );
    for (const n of d.document.nodes) {
      const result = c.nodes.find((r) => r.nodeId === n.id);
      if (
        buildable(n) &&
        n.status === 'built' &&
        n.builtFingerprint &&
        result &&
        result.fingerprint !== n.builtFingerprint
      ) {
        diagnostics.push({
          diagramId: d.id,
          nodeId: n.id,
          connectionId: '',
          code: 'built_changed',
          message: 'Plan changed since marked built',
          itemId: '',
          rate: 0,
        });
      }
    }
    return { ...c, diagnostics };
  });
  for (let pass = 0; pass < workspace.diagrams.length; pass++) {
    let changed = false;
    for (const d of workspace.diagrams) {
      const result = calculations.find((c) => c.diagramId === d.id);
      if (!result || result.calculationKey !== d.calculationKey) continue;
      for (const n of d.document.nodes) {
        if (
          n.kind !== 'link' ||
          !calculations.find((c) => c.diagramId === n.linkedDiagramId)?.diagnostics.length ||
          result.diagnostics.some((v) => v.code === 'linked_warning' && v.nodeId === n.id)
        )
          continue;
        result.diagnostics.push({
          diagramId: d.id,
          nodeId: n.id,
          connectionId: '',
          code: 'linked_warning',
          message: 'Linked factory has unresolved production warnings',
          itemId: '',
          rate: 0,
        });
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { ...workspace, calculations };
}

/** Factories that can be linked without creating a dependency cycle. */
export function linkableDiagrams(diagrams: PlannerDiagram[], diagramId: string) {
  const imports = (id: string, seen = new Set<string>()): boolean => {
    if (id === diagramId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (
      diagrams
        .find((d) => d.id === id)
        ?.document.nodes.some((n) => n.kind === 'link' && imports(n.linkedDiagramId, seen)) ?? false
    );
  };
  return diagrams.filter((d) => !imports(d.id));
}

/** Connections relevant to a current solved diagram; authored and unresolved routes stay visible. */
export function visibleConnections(
  doc: PlannerDocument,
  calculation: PlannerCalculation | undefined,
  stale: boolean
) {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const connections = doc.connections.filter(
    (e) => !nodes.get(e.source)?.disabledOutputs?.includes(e.itemId)
  );
  if (stale || !calculation?.resolved) return connections;
  const rates = new Map(calculation.connections.map((r) => [r.connectionId, r.rate]));
  const warnings = new Set(calculation.diagnostics.map((d) => d.connectionId));
  return connections.filter(
    (e) => !e.generated || !rates.has(e.id) || rates.get(e.id)! > 1e-6 || warnings.has(e.id)
  );
}
