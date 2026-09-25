import type {
  PlannerCatalog,
  PlannerDiagram,
  PlannerDocument,
  PlannerNode,
} from '@/services/plannerApi';

export const settings = () => ({ recipes: [], beltTier: 0, pipeTier: 0 });
export const uid = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export const number = (v: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v);

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
    rate: 60,
    clock: 100,
    somersloops: 0,
    status: 'planned',
    generated: false,
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

export function reparent(doc: PlannerDocument, ids: string[], parentId: string): PlannerDocument {
  const parent = absolute(doc, parentId);
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (!ids.includes(n.id) || n.id === parentId || ancestors(doc, parentId).includes(n.id))
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

export type Port = { nodeId: string; portId: string; itemId: string; source: boolean };
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
      .filter((n) => ['input', 'output'].includes(n.kind))
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
      })),
    ];
  }
  if (node.kind === 'group') return [];
  return (['input', 'output'].includes(node.kind) ? [false, true] : [true]).map((source) => ({
    nodeId: node.id,
    portId: '',
    itemId: node.itemId,
    source,
  }));
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
  const result: Port[] = [];
  for (const n of doc.nodes.filter((n) => inside.has(n.id))) {
    for (const p of ports(n, catalog, diagrams)) {
      const edges = doc.connections.filter((e) =>
        p.source
          ? e.source === n.id && e.itemId === p.itemId && e.sourcePort === p.portId
          : e.target === n.id && e.itemId === p.itemId && e.targetPort === p.portId
      );
      if (edges.some((e) => !inside.has(p.source ? e.target : e.source)) || edges.length === 0)
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

export function materialKey(doc: PlannerDocument) {
  return documentKey({
    settings: doc.settings,
    nodes: doc.nodes.map(
      ({ x: _x, y: _y, width: _w, height: _h, collapsed: _c, name: _n, ...n }) => n
    ),
    connections: doc.connections,
  });
}

export type Recovery = { document: PlannerDocument; revision: number; expand: boolean };
export const recoveryKey = (sessionId: string, diagramId: string) =>
  `planner-draft:${sessionId}:${diagramId}`;
export function readRecovery(key: string): Recovery | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    return value?.document?.version === 1 &&
      Array.isArray(value.document.nodes) &&
      typeof value.revision === 'number'
      ? value
      : null;
  } catch {
    return null;
  }
}
export function writeRecovery(key: string, value: Recovery | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    /* Saving to the server remains available when browser storage is disabled. */
  }
}

/** Stable authored content, independent of GraphQL metadata and object key order. */
export function documentKey(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .filter(([k]) => k !== '__typename' && k !== 'catalogVersion')
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, normalize(val)])
      );
    return v;
  };
  return JSON.stringify(normalize(value));
}

/** Only actual viewport geometry participates in persistence. */
export function sameViewport(a: PlannerDocument['viewport'], b: PlannerDocument['viewport']) {
  return (
    Math.abs(a.x - b.x) < 0.001 &&
    Math.abs(a.y - b.y) < 0.001 &&
    Math.abs(a.zoom - b.zoom) < 0.000001
  );
}
