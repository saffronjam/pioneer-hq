import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Handle, Position, NodeResizer, useStore, type Node, type NodeProps } from '@xyflow/react';
import {
  Box,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  AlertTriangle,
  Target,
  PackagePlus,
} from 'lucide-react';
import type { PlannerNode, PlannerCalculation, PlannerCatalog } from '@/services/plannerApi';
import { number, portKey, buildable, portY, type Port } from './model';
import { MaterialIcon } from './pickers';
import { ConstructionStatus } from './construction-status';
import { itemColor } from './item-color';
import { useNodeMeasurement } from './node-measurements';

export type CardData = {
  node: PlannerNode;
  outputBuilt?: boolean;
  searchMatches?: number;
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

function FactoryCardComponent({ data, selected }: NodeProps<FactoryNode>) {
  const { node: n, ports, result: r, catalog } = data;
  const boundaryGeometry = useStore((state) =>
    JSON.stringify(
      n.kind === 'group' && !n.collapsed
        ? ports.map((p) => {
            const child = state.nodeLookup.get(p.nodeId);
            return {
              key: portKey(p),
              x:
                (child?.position.x ?? 0) +
                (p.source ? (child?.measured.width ?? child?.width ?? 250) : 0),
              y: (child?.position.y ?? 0) + 74,
              source: p.source,
              selected: child?.selected ?? false,
            };
          })
        : []
    )
  );
  const segments: { key: string; x: number; y: number; source: boolean; selected: boolean }[] =
    JSON.parse(boundaryGeometry);
  const signature = JSON.stringify([
    n.kind,
    n.collapsed,
    ports.map((p) => [portKey(p), p.disabled]),
    segments.map(({ key, x, y, source }) => [key, x, y, source]),
  ]);
  useNodeMeasurement(n.id, signature);
  const group = n.kind === 'group';
  const boundary = !buildable(n);
  const BoundaryIcon = n.kind === 'output' ? Target : PackagePlus;
  const machine = catalog.machines.find((m) => m.id === n.machineId);
  const item = catalog.items.find((i) => i.id === n.itemId);
  const accent = itemColor(item?.name);
  const alternate =
    n.kind === 'production' && catalog.recipes.find((r) => r.id === n.recipeId)?.alternate;
  const title = item?.name || n.name || 'Factory';
  const input = ports.filter((p) => !p.source),
    output = ports.filter((p) => p.source);
  const colorStatus =
    n.kind === 'output' && data.outputBuilt ? 'built' : boundary ? 'planned' : n.status;
  const statusBorder =
    colorStatus !== 'planned'
      ? `color-mix(in oklab, var(--color-${colorStatus === 'built' ? 'emerald' : 'amber'}-500) 35%, var(--card))`
      : undefined;
  return (
    <div
      data-search-match={data.searchMatches ? true : undefined}
      aria-label={
        data.searchMatches && n.collapsed
          ? `${data.searchMatches} search matches in this section`
          : undefined
      }
      style={{
        borderColor: selected
          ? undefined
          : (statusBorder ??
            (accent ? `color-mix(in oklab, ${accent} 30%, var(--border))` : undefined)),
        backgroundColor:
          colorStatus !== 'planned'
            ? `color-mix(in oklab, var(--color-${colorStatus === 'built' ? 'emerald' : 'amber'}-500) 12%, var(--card))`
            : accent
              ? `color-mix(in oklab, ${accent} 6%, var(--card))`
              : undefined,
      }}
      className={`h-full w-full rounded-lg border text-foreground shadow-sm transition-[background-color] duration-150 ease-out motion-reduce:transition-none ${selected ? 'border-primary ring-1 ring-primary' : 'border-border'} ${group && !n.collapsed ? 'bg-muted/90' : 'bg-card'} ${n.kind === 'link' ? 'border-dashed border-2' : boundary ? 'border-dashed' : ''}`}
    >
      {group && (
        <NodeResizer
          minWidth={300}
          minHeight={180}
          isVisible={selected && !n.collapsed}
          onResizeStart={data.rememberResize}
        />
      )}
      <div
        className="flex h-[52px] items-center gap-2 border-b px-3"
        style={{ borderColor: statusBorder }}
      >
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
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">{title}</span>
            {(alternate || n.surplus) && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {n.surplus ? 'Surplus' : 'Alternate'}
              </Badge>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {n.kind === 'link'
              ? 'Linked factory'
              : n.kind === 'supply'
                ? 'Input'
                : n.kind === 'input'
                  ? 'Required input'
                  : n.kind === 'output'
                    ? n.exposed
                      ? 'Factory output'
                      : 'Output target'
                    : n.kind}
          </div>
        </div>
        {!boundary && (
          <span className="flex shrink-0 items-center text-[10px] text-muted-foreground">
            <ConstructionStatus value={n.status} />
          </span>
        )}
        {boundary && n.kind !== 'input' && (
          <BoundaryIcon size={16} className="text-muted-foreground" />
        )}
        {data.warnings > 0 && n.kind !== 'input' && (
          <AlertTriangle size={14} className="shrink-0 text-amber-500" />
        )}
        {n.kind === 'link' && (
          <button aria-label="Open linked factory" className="nodrag" onClick={data.open}>
            <ExternalLink size={14} />
          </button>
        )}
      </div>
      {(!group || n.collapsed) && (
        <>
          {boundary ? (
            <>
              <div className="flex h-11 items-center px-3 font-mono text-base">
                {(n.kind === 'input' && n.inputRateMode !== 'fixed') ||
                (n.kind === 'output' && n.outputRateMode === 'demand')
                  ? r
                    ? number(r.outputs.reduce((sum, output) => sum + output.rate, 0))
                    : '—'
                  : number(n.rate)}{' '}
                {item?.form === 'solid' ? 'items' : 'm³'}/min
                {((n.kind === 'input' && n.inputRateMode === 'fixed') ||
                  (n.kind === 'output' && n.exposed)) && (
                  <span className="ml-2 font-sans text-xs text-muted-foreground">
                    {n.kind === 'output' && n.outputRateMode === 'demand' ? 'Demand' : 'Fixed'}
                  </span>
                )}
              </div>
              {n.kind === 'output' && n.exposed && (
                <div className="h-6 px-3 text-[10px] text-muted-foreground">
                  {r
                    ? `${number(r.exportRate)}/min export demand · ${number(r.surplusRate)}/min surplus`
                    : 'Awaiting calculation'}
                </div>
              )}
            </>
          ) : (
            <>
              {n.kind === 'production' && (
                <div className="h-12 px-3 py-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 font-medium">
                      {machine && (
                        <MaterialIcon key={machine.name} name={machine.name} className="size-5" />
                      )}
                      <span className="truncate">
                        {r ? `${r.machines} ×` : '—'} {machine?.name}
                      </span>
                    </span>
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {number(n.clock, 1)}% clock ·{' '}
                    {r ? `${number(r.utilization * 100, 1)}% utilization` : 'Awaiting calculation'}
                    {n.somersloops > 0 ? ` · ${n.somersloops} loops` : ''}
                    {data.locked ? ' · Not unlocked' : ''}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-4 px-3 pb-2 text-[11px]">
                {[input, output].map((ps, side) => (
                  <div key={side} className="min-w-0">
                    {ps.map((p) => {
                      const material = catalog.items.find((i) => i.id === p.itemId);
                      return (
                        <div
                          key={portKey(p)}
                          data-port-row={portKey(p)}
                          data-output-disabled={p.disabled || undefined}
                          className={`flex h-6 items-center gap-1.5 ${side ? 'justify-end' : ''} ${p.disabled ? 'text-muted-foreground opacity-40 grayscale' : ''}`}
                        >
                          {material && (
                            <MaterialIcon
                              key={material.id}
                              name={material.name}
                              className="size-4"
                            />
                          )}
                          <span className="truncate">{material?.name ?? p.itemId}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {group && !n.collapsed && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          {segments.map((segment) => (
            <line
              key={segment.key}
              data-boundary-port={segment.key}
              className={selected || segment.selected ? 'planner-boundary-flow' : undefined}
              x1={segment.source ? segment.x : 0}
              x2={segment.source ? '100%' : segment.x}
              y1={segment.y}
              y2={segment.y}
              stroke="var(--muted-foreground)"
              strokeWidth={1.5}
            />
          ))}
        </svg>
      )}
      {[input, output].map((ps) =>
        ps.map((p, i) =>
          p.disabled ? null : (
            <Handle
              key={portKey(p)}
              id={portKey(p)}
              type={p.source ? 'source' : 'target'}
              position={p.source ? Position.Right : Position.Left}
              aria-label={catalog.items.find((it) => it.id === p.itemId)?.name}
              style={{
                top: segments.find((s) => s.key === portKey(p))?.y ?? portY(n, i),
                width: 9,
                height: 9,
                background: 'var(--primary)',
                borderColor: 'var(--background)',
              }}
            />
          )
        )
      )}
    </div>
  );
}

export const FactoryCard = memo(FactoryCardComponent);
