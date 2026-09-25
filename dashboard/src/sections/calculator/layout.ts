import type { ELK, ElkNode } from 'elkjs/lib/elk-api';
import type { PlannerDocument } from '@/services/plannerApi';

export async function arrangeDocument(doc: PlannerDocument, elk: ELK) {
  const children = (parentId: string): ElkNode[] =>
    doc.nodes
      .filter((n) => n.parentId === parentId)
      .map((n) => ({
        id: n.id,
        width: n.kind === 'group' ? 500 : 250,
        height: n.kind === 'group' ? 300 : 200,
        ...(n.kind === 'group'
          ? {
              children: children(n.id),
              layoutOptions: { 'elk.padding': '[top=65,left=40,bottom=40,right=40]' },
            }
          : {}),
      }));
  const layout = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '55',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
    },
    children: children(''),
    edges: doc.connections.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });
  const positions: Record<string, { x: number; y: number; width: number; height: number }> = {};
  const visit = (n: ElkNode) => {
    if (n.id !== 'root')
      positions[n.id] = {
        x: n.x ?? 0,
        y: n.y ?? 0,
        width: n.width ?? 250,
        height: n.height ?? 200,
      };
    n.children?.forEach(visit);
  };
  visit(layout);

  return positions;
}
