import type { ELK, ElkNode } from 'elkjs/lib/elk-api';
import {
  ancestors,
  nodeDimensions,
  ports,
  groupPorts,
  portKey,
  portY,
  visibleNode,
  sectionPortY,
} from './model';
import type { PlannerDocument, PlannerCatalog, PlannerDiagram } from '@/services/plannerApi';

export async function arrangeDocument(
  doc: PlannerDocument,
  elk: ELK,
  catalog?: PlannerCatalog,
  diagrams: PlannerDiagram[] = []
) {
  const positions: Record<string, { x: number; y: number; width: number; height: number }> = {};
  const arrangeScope = async (parentId: string) => {
    const siblings = doc.nodes.filter(
      (n) => n.parentId === parentId && visibleNode(doc, n.id) === n.id
    );
    for (const n of siblings) {
      if (n.kind === 'group' && !n.collapsed) await arrangeScope(n.id);
    }
    const positioned = { ...doc, nodes: doc.nodes.map((n) => ({ ...n, ...positions[n.id] })) };
    const portMap = new Map(
      siblings.map((n) => [
        n.id,
        catalog
          ? n.kind === 'group'
            ? groupPorts(positioned, n.id, catalog, diagrams)
            : ports(n, catalog, diagrams)
          : [],
      ])
    );
    const siblingIds = new Set(siblings.map((n) => n.id));
    const owner = (id: string) => [id, ...ancestors(doc, id)].find((id) => siblingIds.has(id));
    const connections = doc.connections.flatMap((e) => {
      const source = owner(e.source),
        target = owner(e.target);
      return source && target && source !== target
        ? [{ ...e, sourceNode: source, targetNode: target }]
        : [];
    });
    const endpoint = (
      ownerId: string,
      nodeId: string,
      portId: string,
      itemId: string,
      source: boolean
    ) => {
      const key = portKey({ nodeId, portId, itemId, source });
      return portMap.get(ownerId)?.some((p) => portKey(p) === key) ? key : ownerId;
    };
    const layout = await elk.layout({
      id: parentId || 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.padding': parentId
          ? '[top=80,left=40,bottom=40,right=40]'
          : '[top=0,left=0,bottom=0,right=0]',
        'elk.spacing.nodeNode': '70',
        'elk.layered.spacing.nodeNodeBetweenLayers': '120',
        'elk.layered.layering.strategy': 'LONGEST_PATH_SOURCE',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      },
      children: siblings.map((n): ElkNode => {
        const ps = portMap.get(n.id)!;
        const dimensions =
          n.kind === 'group' && !n.collapsed
            ? positions[n.id]
            : nodeDimensions(n, catalog, diagrams, ps);
        return {
          id: n.id,
          width: dimensions.width,
          height: dimensions.height,
          ports: ps.map((p) => ({
            id: portKey(p),
            width: 0,
            height: 0,
            x: p.source ? dimensions.width : 0,
            y:
              n.kind === 'group' && !n.collapsed
                ? sectionPortY(positioned, n.id, p)
                : portY(n, ps.filter((q) => q.source === p.source).indexOf(p)),
            layoutOptions: { 'elk.port.side': p.source ? 'EAST' : 'WEST' },
          })),
          layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
        };
      }),
      edges: connections.map((e) => ({
        id: e.id,
        sources: [endpoint(e.sourceNode, e.source, e.sourcePort, e.itemId, true)],
        targets: [endpoint(e.targetNode, e.target, e.targetPort, e.itemId, false)],
      })),
    });
    for (const n of layout.children ?? []) {
      positions[n.id] = {
        x: n.x ?? 0,
        y: n.y ?? 0,
        width: n.width ?? 250,
        height: n.height ?? 180,
      };
    }
    const layers: (typeof siblings)[] = [];
    const inputs = siblings.filter((n) => n.kind === 'input' || n.kind === 'supply');
    const outputs = siblings.filter((n) => n.kind === 'output');
    const boundaries = new Set([...inputs, ...outputs].map((n) => n.id));
    const firstProductionX = Math.min(
      ...siblings
        .filter(
          (n) =>
            n.kind === 'production' &&
            connections.some(
              (e) => e.targetNode === n.id && inputs.some((input) => input.id === e.sourceNode)
            )
        )
        .map((n) => positions[n.id].x)
    );
    if (Number.isFinite(firstProductionX)) {
      for (const n of siblings.filter((n) => n.kind === 'production')) {
        if (
          positions[n.id].x < firstProductionX &&
          !connections.some((e) => e.targetNode === n.id) &&
          connections
            .filter((e) => e.sourceNode === n.id)
            .every(
              (e) => boundaries.has(e.targetNode) || positions[e.targetNode].x > firstProductionX
            )
        )
          positions[n.id].x = firstProductionX;
      }
    }
    let layerRight = -Infinity;
    for (const n of siblings
      .filter((n) => !boundaries.has(n.id))
      .sort((a, b) => positions[a.id].x - positions[b.id].x)) {
      const p = positions[n.id];
      if (p.x >= layerRight) layers.push([]);
      layers.at(-1)!.push(n);
      layerRight = Math.max(layerRight, p.x + p.width);
    }
    if (inputs.length) layers.unshift(inputs);
    if (outputs.length) layers.push(outputs);
    for (const boundary of layers) {
      let bottom = parentId ? 80 : 0;
      for (const n of boundary.sort(
        (a, b) => positions[a.id].y - positions[b.id].y || a.id.localeCompare(b.id)
      )) {
        positions[n.id].y = Math.max(bottom, positions[n.id].y);
        bottom = positions[n.id].y + positions[n.id].height + 70;
      }
    }
    const layerIndex = new Map(layers.flatMap((layer, i) => layer.map((n) => [n.id, i] as const)));
    let right = 0;
    for (const [i, layer] of layers.entries()) {
      const crossing = connections.filter(
        ({ sourceNode, targetNode }) =>
          Math.min(layerIndex.get(sourceNode)!, layerIndex.get(targetNode)!) < i &&
          Math.max(layerIndex.get(sourceNode)!, layerIndex.get(targetNode)!) >= i
      );
      const verticalSpan = crossing.reduce(
        (max, { sourceNode, targetNode }) =>
          Math.max(max, Math.abs(positions[sourceNode].y - positions[targetNode].y)),
        0
      );
      const gap = Math.min(
        720,
        Math.max(120, 90 + crossing.length * 18 + Math.sqrt(verticalSpan) * 5)
      );
      const x = i === 0 ? (parentId ? 40 : 0) : right + gap;
      for (const n of layer) positions[n.id].x = x;
      right = Math.max(...layer.map((n) => x + positions[n.id].width));
    }
    if (parentId)
      positions[parentId] = {
        x: 0,
        y: 0,
        width: Math.max(300, right + 40),
        height: Math.max(
          180,
          ...siblings.map((n) => positions[n.id].y + positions[n.id].height + 40)
        ),
      };
  };
  await arrangeScope('');
  return positions;
}

/** Places new nodes beside their existing anchors without moving established cards. */
export async function arrangeNewNodes(
  doc: PlannerDocument,
  before: PlannerDocument,
  elk: ELK,
  catalog?: PlannerCatalog,
  diagrams: PlannerDiagram[] = []
): Promise<PlannerDocument> {
  const fixed = new Set(before.nodes.map((n) => n.id));
  const positions = await arrangeDocument(
    { ...doc, nodes: doc.nodes.map((n) => (n.kind === 'group' ? { ...n, collapsed: false } : n)) },
    elk,
    catalog,
    diagrams
  );
  let nodes = doc.nodes.map((n) => ({ ...n }));
  const scopes = [...new Set(nodes.filter((n) => !fixed.has(n.id)).map((n) => n.parentId))];
  for (const scope of scopes) {
    const added = nodes.filter((n) => n.parentId === scope && !fixed.has(n.id));
    const addedIds = new Set(added.map((n) => n.id));
    const anchors = doc.connections.flatMap((e) =>
      addedIds.has(e.source) && fixed.has(e.target)
        ? [e.target]
        : addedIds.has(e.target) && fixed.has(e.source)
          ? [e.source]
          : []
    );
    const anchor = nodes.find((n) => n.id === anchors[0] && n.parentId === scope);
    const dx = anchor ? anchor.x - positions[anchor.id].x : added[0].x - positions[added[0].id].x;
    let dy = anchor ? anchor.y - positions[anchor.id].y : added[0].y - positions[added[0].id].y;
    const obstacles = nodes.filter((n) => n.parentId === scope && fixed.has(n.id));
    const intersects = () =>
      added.some((n) =>
        obstacles.some((o) => {
          const p = positions[n.id],
            d = nodeDimensions(o, catalog, diagrams);
          return (
            p.x + dx < o.x + d.width + 35 &&
            p.x + dx + p.width + 35 > o.x &&
            p.y + dy < o.y + d.height + 35 &&
            p.y + dy + p.height + 35 > o.y
          );
        })
      );
    while (intersects()) dy += 55;
    nodes = nodes.map((n) =>
      addedIds.has(n.id)
        ? { ...n, ...positions[n.id], x: positions[n.id].x + dx, y: positions[n.id].y + dy }
        : n
    );
  }
  const alignBoundaries = (scope: string) => {
    const siblings = nodes.filter((n) => n.parentId === scope);
    const inputs = siblings.filter((n) => n.kind === 'input' || n.kind === 'supply');
    const outputs = siblings.filter((n) => n.kind === 'output');
    const middle = siblings.filter((n) => !inputs.includes(n) && !outputs.includes(n));
    const width = (n: (typeof siblings)[number]) => nodeDimensions(n, catalog, diagrams).width;
    const inputX = Math.min(
      ...inputs.map((n) => n.x),
      ...middle.map((n) => n.x - 120 - Math.max(0, ...inputs.map(width)))
    );
    const outputX = Math.max(
      ...outputs.map((n) => n.x),
      ...middle.map((n) => n.x + width(n) + 120),
      ...inputs.map((n) => inputX + width(n) + 120)
    );
    for (const [boundary, x] of [
      [inputs, inputX],
      [outputs, outputX],
    ] as const) {
      let bottom = -Infinity;
      for (const n of [...boundary].sort((a, b) => a.y - b.y || a.id.localeCompare(b.id))) {
        const y = Math.max(bottom, n.y);
        nodes = nodes.map((v) => (v.id === n.id ? { ...v, x, y } : v));
        bottom = y + nodeDimensions(n, catalog, diagrams).height + 70;
      }
    }
  };
  const groups = nodes
    .filter((n) => n.kind === 'group')
    .sort((a, b) => ancestors(doc, b.id).length - ancestors(doc, a.id).length);
  for (const group of groups) {
    alignBoundaries(group.id);
    const children = nodes.filter((n) => n.parentId === group.id);
    if (!children.length) continue;
    const left = Math.min(0, ...children.map((n) => n.x - 40));
    const top = Math.min(0, ...children.map((n) => n.y - 65));
    const right = Math.max(
      group.width,
      ...children.map((n) => n.x + nodeDimensions(n, catalog, diagrams).width + 40)
    );
    const bottom = Math.max(
      group.height,
      ...children.map((n) => n.y + nodeDimensions(n, catalog, diagrams).height + 40)
    );
    nodes = nodes.map((n) =>
      n.id === group.id
        ? { ...n, x: n.x + left, y: n.y + top, width: right - left, height: bottom - top }
        : n.parentId === group.id
          ? { ...n, x: n.x - left, y: n.y - top }
          : n
    );
  }
  alignBoundaries('');
  return { ...doc, nodes };
}
