import { useEffect, useState } from 'react';
import { ReactFlow, applyNodeChanges, type ReactFlowProps } from '@xyflow/react';
import type { FactoryNode } from './nodes';
import type { MaterialEdgeType } from './edges';
import { NodeMeasurementsProvider } from './node-measurements';

/** Keeps pointer-move updates local; the editor receives completed geometry changes. */
export function PlannerCanvas({
  nodes = [],
  onNodesChange,
  ...props
}: ReactFlowProps<FactoryNode, MaterialEdgeType>) {
  const [displayNodes, setDisplayNodes] = useState(nodes);
  useEffect(() => {
    setDisplayNodes((previous) => {
      const moving = new Map(
        previous.filter((n) => n.dragging || n.resizing).map((n) => [n.id, n])
      );
      return nodes.map((n) => {
        const active = moving.get(n.id);
        return active
          ? {
              ...n,
              position: active.position,
              measured: active.measured,
              dragging: active.dragging,
              resizing: active.resizing,
            }
          : n;
      });
    });
  }, [nodes]);
  return (
    <NodeMeasurementsProvider>
      <ReactFlow<FactoryNode, MaterialEdgeType>
        {...props}
        nodes={displayNodes}
        onNodesChange={(changes) => {
          setDisplayNodes((current) => applyNodeChanges(changes, current));
          const committed = changes.filter(
            (c) =>
              c.type === 'select' ||
              (c.type === 'position' && c.dragging === false) ||
              (c.type === 'dimensions' && c.resizing === false)
          );
          if (committed.length) onNodesChange?.(committed);
        }}
      />
    </NodeMeasurementsProvider>
  );
}
