import { useEffect } from 'react';
import {
  Handle,
  Position,
  NodeResizer,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { Box, ChevronDown, ChevronRight, ExternalLink, Factory, AlertTriangle } from 'lucide-react';
import type { PlannerNode, PlannerCalculation, PlannerCatalog } from '@/services/plannerApi';
import { number, portKey, type Port } from './model';

export type CardData = {
  node: PlannerNode;
  ports: Port[];
  catalog: PlannerCatalog;
  result?: PlannerCalculation['nodes'][number];
  warnings: number;
  locked: boolean;
  toggle: () => void;
  rememberResize: () => void;
  open: () => void;
};
export type FactoryNode = Node<CardData, 'factory'>;

export function FactoryCard({ data, selected }: NodeProps<FactoryNode>) {
  const { node: n, ports, result: r, catalog } = data;
  const updateInternals = useUpdateNodeInternals();
  const signature = ports.map(portKey).join('|');
  useEffect(() => {
    updateInternals(n.id);
  }, [n.id, n.collapsed, signature, updateInternals]);
  const group = n.kind === 'group';
  const machine = catalog.machines.find((m) => m.id === n.machineId);
  const item = catalog.items.find((i) => i.id === n.itemId);
  const input = ports.filter((p) => !p.source),
    output = ports.filter((p) => p.source);
  return (
    <div
      className={`h-full w-full rounded-lg border text-foreground shadow-sm ${selected ? 'border-primary ring-1 ring-primary' : 'border-border'} ${group && !n.collapsed ? 'bg-muted/30' : 'bg-card'} ${n.kind === 'link' ? 'border-dashed border-2' : ''}`}
    >
      {group && (
        <NodeResizer
          minWidth={300}
          minHeight={180}
          isVisible={selected && !n.collapsed}
          onResizeStart={data.rememberResize}
        />
      )}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {group ? (
          <button
            aria-label={n.collapsed ? 'Expand section' : 'Collapse section'}
            className="nodrag"
            onClick={data.toggle}
          >
            {n.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
        ) : item ? (
          <img
            alt=""
            className="size-7 object-contain"
            src={`/assets/images/satisfactory/64x64/${encodeURIComponent(item.name)}.png`}
            onError={(e) => {
              e.currentTarget.style.visibility = 'hidden';
            }}
          />
        ) : (
          <Box size={18} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{n.name || item?.name || 'Factory'}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {n.kind === 'link' ? 'Linked factory · shared capacity' : n.kind}
          </div>
        </div>
        {data.warnings > 0 && <AlertTriangle size={14} className="text-amber-500" />}
        {n.kind === 'link' && (
          <button aria-label="Open linked factory" className="nodrag" onClick={data.open}>
            <ExternalLink size={14} />
          </button>
        )}
      </div>
      {(!group || n.collapsed) && (
        <>
          <div className="px-3 py-2 text-xs">
            {n.kind === 'production' && (
              <>
                <div className="flex items-center gap-1 font-medium">
                  <Factory size={13} /> {r ? `${r.machines} ×` : '—'} {machine?.name}
                </div>
                <div className="mt-1 text-muted-foreground">
                  {number(n.clock)}% clock ·{' '}
                  {r ? `${number(r.utilization * 100)}% utilization` : 'Awaiting calculation'}
                  {n.somersloops > 0 ? ` · ${n.somersloops} loops / machine` : ''}
                </div>
              </>
            )}
            {['output', 'supply'].includes(n.kind) && (
              <div className="font-mono text-base">
                {number(n.rate)} {item?.form === 'solid' ? 'items' : 'm³'}/min
              </div>
            )}
            {n.kind === 'input' && (
              <div>Required: {number(r?.outputs.reduce((a, b) => a + b.rate, 0) ?? 0)}/min</div>
            )}
            <div className="mt-1 flex justify-between text-muted-foreground">
              <span
                className={
                  n.status === 'built'
                    ? 'text-emerald-500'
                    : n.status === 'building'
                      ? 'text-amber-500'
                      : ''
                }
              >
                {n.status}
              </span>
              {data.locked && <span>Not unlocked</span>}
            </div>
          </div>
          <div className="flex justify-between gap-4 px-3 pb-3 text-[10px] text-muted-foreground">
            {[input, output].map((ps, side) => (
              <div key={side} className={side ? 'text-right' : ''}>
                {ps.map((p) => (
                  <div key={portKey(p)} className="max-w-28 truncate">
                    {catalog.items.find((i) => i.id === p.itemId)?.name}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
      {[input, output].map((ps) =>
        ps.map((p, i) => (
          <Handle
            key={portKey(p)}
            id={portKey(p)}
            type={p.source ? 'source' : 'target'}
            position={p.source ? Position.Right : Position.Left}
            title={catalog.items.find((it) => it.id === p.itemId)?.name}
            style={{
              top: 70 + i * 21,
              width: 9,
              height: 9,
              background: 'var(--primary)',
              borderColor: 'var(--background)',
            }}
          />
        ))
      )}
    </div>
  );
}
