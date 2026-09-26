import { expect, test } from 'bun:test';
import { connectionCurve, connectionLabels, type Box, type ConnectionRoute } from './edges';

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test('shared output branches keep labels clear of each other and adjacent cards', () => {
  const routes: ConnectionRoute[] = [
    {
      id: 'screws',
      source: { x: 320, y: 112 },
      target: { x: 460, y: 112 },
      label: '41.25/min · 1 × Mk.1',
    },
    {
      id: 'frames',
      source: { x: 320, y: 112 },
      target: { x: 890, y: 112 },
      label: '12/min · 1 × Mk.1',
    },
  ];
  const cards: Box[] = [
    { x: 0, y: 0, width: 320, height: 132 },
    { x: 460, y: 0, width: 320, height: 132 },
    { x: 890, y: 0, width: 320, height: 156 },
  ];
  const labels = connectionLabels(routes, cards);
  expect(labels.size).toBe(2);
  const boxes = [...labels.values()];
  expect(overlaps(boxes[0], boxes[1])).toBe(false);
  for (const box of boxes) expect(cards.some((card) => overlaps(box, card))).toBe(false);
  expect(connectionLabels([...routes].reverse(), cards)).toEqual(labels);
  const branch = routes[1];
  const curve = connectionCurve(branch.source, branch.target);
  expect(curve.point(0)).toEqual(branch.source);
  expect(curve.point(1)).toEqual(branch.target);
  expect(curve.point(0.2).y).toBeCloseTo(branch.source.y);
});
