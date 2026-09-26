import type { PlannerCatalog, PlannerDiagram, PlannerDocument } from '@/services/plannerApi';
import {
  absolute,
  connectionNode,
  groupPorts,
  nodeDimensions,
  ports,
  portKey,
  portY,
  sectionPortY,
  visibleNode,
} from './model';

type Point = { x: number; y: number };
const turn = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const crosses = (a: Point, b: Point, c: Point, d: Point) =>
  turn(a, b, c) * turn(a, b, d) < -0.001 && turn(c, d, a) * turn(c, d, b) < -0.001;

/** Reduces crossings between a node's connections by reordering material rows only. */
export function orderedNodePorts(
  doc: PlannerDocument,
  catalog: PlannerCatalog,
  diagrams: PlannerDiagram[]
) {
  const nodes = doc.nodes.filter((n) => visibleNode(doc, n.id) === n.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const positions = new Map(nodes.map((n) => [n.id, absolute(doc, n.id)]));
  const ordered = new Map(
    nodes.map((n) => [
      n.id,
      n.kind === 'group' ? groupPorts(doc, n.id, catalog, diagrams) : ports(n, catalog, diagrams),
    ])
  );
  const edges = doc.connections
    .map((edge) => ({
      source: connectionNode(doc, edge.source, true),
      target: connectionNode(doc, edge.target, false),
      sourceKey: portKey({
        nodeId: edge.source,
        portId: edge.sourcePort,
        itemId: edge.itemId,
        source: true,
      }),
      targetKey: portKey({
        nodeId: edge.target,
        portId: edge.targetPort,
        itemId: edge.itemId,
        source: false,
      }),
    }))
    .filter((edge) => edge.source !== edge.target);
  const endpoint = (id: string, key: string, source: boolean): Point | undefined => {
    const node = byId.get(id);
    if (!node) return;
    const ps = ordered.get(id)!;
    const side = ps.filter((p) => p.source === source);
    const index = side.findIndex((p) => portKey(p) === key);
    if (index < 0) return;
    const position = positions.get(id)!;
    return {
      x: position.x + (source ? nodeDimensions(node, catalog, diagrams, ps).width : 0),
      y:
        position.y +
        (node.kind === 'group' && !node.collapsed
          ? sectionPortY(doc, id, side[index])
          : portY(node, index)),
    };
  };
  const sweep = [...nodes].sort(
    (a, b) => positions.get(a.id)!.x - positions.get(b.id)!.x || a.id.localeCompare(b.id)
  );
  for (const pass of [sweep, [...sweep].reverse()]) {
    for (const node of pass) {
      if (node.kind === 'group' && !node.collapsed) continue;
      for (const source of [false, true]) {
        const ps = ordered.get(node.id)!;
        const side = ps.filter((p) => p.source === source);
        if (side.length < 2) continue;
        const connections = edges.filter(
          (edge) => (source ? edge.source : edge.target) === node.id
        );
        const crossings = () => {
          const segments = connections.flatMap((edge) => {
            const a = endpoint(edge.source, edge.sourceKey, true);
            const b = endpoint(edge.target, edge.targetKey, false);
            return a && b ? [{ a, b }] : [];
          });
          let count = 0;
          for (let i = 0; i < segments.length; i++)
            for (let j = i + 1; j < segments.length; j++)
              if (crosses(segments[i].a, segments[i].b, segments[j].a, segments[j].b)) count++;
          return count;
        };
        const apply = () =>
          ordered.set(
            node.id,
            source
              ? [...ps.filter((p) => !p.source), ...side]
              : [...side, ...ps.filter((p) => p.source)]
          );
        let score = crossings();
        let improved = true;
        while (improved && score > 0) {
          improved = false;
          for (let i = 0; i < side.length - 1; i++) {
            [side[i], side[i + 1]] = [side[i + 1], side[i]];
            apply();
            const next = crossings();
            if (next < score) {
              score = next;
              improved = true;
            } else {
              [side[i], side[i + 1]] = [side[i + 1], side[i]];
              apply();
            }
          }
        }
      }
    }
  }
  return ordered;
}
