import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';

export type Point = { x: number; y: number };
export type Box = Point & { width: number; height: number };
export type ConnectionRoute = {
  id: string;
  source: Point;
  target: Point;
  label: string;
};

/** A directed curve with horizontal departure and arrival tangents. */
export function connectionCurve(source: Point, target: Point) {
  const bend = Math.max(45, Math.abs(target.x - source.x) * 0.35);
  const a = { x: source.x + bend, y: source.y };
  const b = { x: target.x - bend, y: target.y };
  return {
    path: `M ${source.x},${source.y} C ${a.x},${a.y} ${b.x},${b.y} ${target.x},${target.y}`,
    point: (t: number) => {
      const u = 1 - t;
      return {
        x: u ** 3 * source.x + 3 * u ** 2 * t * a.x + 3 * u * t ** 2 * b.x + t ** 3 * target.x,
        y: u ** 3 * source.y + 3 * u ** 2 * t * a.y + 3 * u * t ** 2 * b.y + t ** 3 * target.y,
      };
    },
  };
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width + 4 &&
  a.x + a.width + 4 > b.x &&
  a.y < b.y + b.height + 4 &&
  a.y + a.height + 4 > b.y;

/** Places labels beside their curves without covering cards or other labels. */
export function connectionLabels(routes: ConnectionRoute[], obstacles: Box[]) {
  const occupied = [...obstacles];
  const labels = new Map<string, Box>();
  for (const route of [...routes].sort((a, b) => a.id.localeCompare(b.id))) {
    const curve = connectionCurve(route.source, route.target);
    const width = route.label.length * 6 + 12;
    let placed: Box | undefined;
    for (let distance = 14; !placed; distance += 22) {
      for (const t of [0.62, 0.45, 0.78, 0.3]) {
        const point = curve.point(t);
        for (const direction of [-1, 1]) {
          const box = {
            x: point.x - width / 2,
            y: point.y + direction * distance - 9,
            width,
            height: 18,
          };
          if (!occupied.some((other) => overlaps(box, other))) {
            placed = box;
            break;
          }
        }
        if (placed) break;
      }
    }
    occupied.push(placed);
    labels.set(route.id, placed);
  }
  return labels;
}

export type MaterialEdgeType = Edge<
  { anchor: Point; label: string; warning?: string; box: Box; select: () => void },
  'material'
>;

/** Connection path and a label layered above all paths, below node cards. */
function MaterialEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  data,
  selected,
}: EdgeProps<MaterialEdgeType>) {
  const curve = connectionCurve({ x: sourceX, y: sourceY }, { x: targetX, y: targetY });
  const anchor = curve.point(0.5);
  return (
    <>
      <BaseEdge id={id} path={curve.path} style={style} interactionWidth={24} />
      {data && (
        <EdgeLabelRenderer>
          <button
            className="nodrag nopan pointer-events-auto absolute h-[18px] whitespace-nowrap rounded-sm bg-card px-1 text-center text-[10px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            style={{
              transform: `translate(${data.box.x + anchor.x - data.anchor.x}px, ${data.box.y + anchor.y - data.anchor.y}px)`,
              width: data.box.width,
              fontWeight: selected ? 600 : 400,
            }}
            onClick={(event) => {
              event.stopPropagation();
              data.select();
            }}
            title={data.warning}
            aria-label={`Select connection: ${data.label}${data.warning ? `. ${data.warning}` : ''}`}
          >
            {data.label}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const MaterialEdge = memo(MaterialEdgeComponent);
