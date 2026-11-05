// Where each pixel sits on the drawn boot. The top view lays the ring around a sole outline;
// the side view shows the outer side, the one the controller is on. Both follow the strip's
// layout (src/engine/strip.ts): each arc between toe and heel runs evenly along one side of
// the sole, the arc through pixel 0 on the outer side, so the controller lands wherever
// pixel 0 is.
//
// Coordinates are in a fixed reference box per view; the drawing code scales them to fit.

import { foreAft, onOuterArc, type StripLayout } from "../engine/strip";

export interface Point {
  x: number;
  y: number;
}

export const TOP_BOX = { width: 260, height: 644 };
export const SIDE_BOX = { width: 600, height: 340 };

// A right boot from above, toe up, clockwise from the toe apex. The big toe side is on the
// left, so the toe apex sits left of center.
const SOLE_POINTS: Point[] = [
  { x: 112, y: 18 },
  { x: 160, y: 30 },
  { x: 196, y: 70 },
  { x: 214, y: 130 },
  { x: 218, y: 200 },
  { x: 208, y: 280 },
  { x: 196, y: 360 },
  { x: 194, y: 440 },
  { x: 196, y: 520 },
  { x: 184, y: 585 },
  { x: 150, y: 620 },
  { x: 118, y: 626 },
  { x: 86, y: 612 },
  { x: 70, y: 570 },
  { x: 68, y: 500 },
  { x: 72, y: 430 },
  { x: 64, y: 360 },
  { x: 50, y: 290 },
  { x: 38, y: 210 },
  { x: 42, y: 130 },
  { x: 60, y: 66 },
  { x: 84, y: 30 },
];
const SAMPLES_PER_SEGMENT = 24;

// The sole outline as a dense closed polyline, clockwise from the toe apex.
export const SOLE_OUTLINE: Point[] = catmullRomLoop(SOLE_POINTS, SAMPLES_PER_SEGMENT);

export interface TopGeometry {
  outline: Point[];
  controller: Point;
  pixels: Point[];
}

// The sole's two sides, each from the toe apex to the heel. The outer (little toe) side of
// a right boot is on the right from above.
const TOE_AT = indexOfMin(SOLE_OUTLINE, (p) => p.y);
const HEEL_AT = indexOfMin(SOLE_OUTLINE, (p) => -p.y);
const OUTER_SIDE = sidePath(TOE_AT, HEEL_AT, 1);
const INNER_SIDE = sidePath(TOE_AT, HEEL_AT, -1);

// Places every pixel on the outline: its arc's side of the sole, as far from the toe apex as
// it is along the arc.
export function topGeometry(layout: StripLayout): TopGeometry {
  const pixels: Point[] = [];
  for (let i = 0; i < layout.count; i++) {
    const side = onOuterArc(i, layout) ? OUTER_SIDE : INNER_SIDE;
    pixels.push(pointAt(side.points, side.lengths, (1 - foreAft(i, layout)) * side.total));
  }
  return { outline: SOLE_OUTLINE, controller: pixels[0]!, pixels };
}

export interface SideGeometry {
  // Pixels on the near (outer) side, with where each sits along the sole.
  near: { index: number; point: Point }[];
  heelContact: Point;
  toeContact: Point;
}

const SIDE_HEEL_X = 50;
const SIDE_TOE_X = 540;
const SIDE_STRIP_Y = 287;
export const SIDE_GROUND_Y = 300;

// The outer side holds the arc through pixel 0.
export function sideGeometry(layout: StripLayout): SideGeometry {
  const near: SideGeometry["near"] = [];
  for (let i = 0; i < layout.count; i++) {
    if (!onOuterArc(i, layout)) continue;
    const s = foreAft(i, layout);
    near.push({ index: i, point: { x: SIDE_HEEL_X + s * (SIDE_TOE_X - SIDE_HEEL_X), y: SIDE_STRIP_Y } });
  }
  return {
    near,
    heelContact: { x: SIDE_HEEL_X - 4, y: SIDE_GROUND_Y },
    toeContact: { x: SIDE_TOE_X + 4, y: SIDE_GROUND_Y },
  };
}

// The outline from one index to another, stepping forward (clockwise) or back, with each
// point's distance along the way.
function sidePath(from: number, to: number, step: 1 | -1): { points: Point[]; lengths: number[]; total: number } {
  const n = SOLE_OUTLINE.length;
  const points: Point[] = [];
  for (let i = from; ; i = (i + step + n) % n) {
    points.push(SOLE_OUTLINE[i]!);
    if (i === to) break;
  }
  const lengths = cumulativeLengths(points);
  return { points, lengths, total: lengths[lengths.length - 1]! };
}

function cumulativeLengths(points: Point[]): number[] {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    lengths.push(lengths[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return lengths;
}

function pointAt(points: Point[], lengths: number[], s: number): Point {
  let lo = 0;
  let hi = lengths.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const span = lengths[hi]! - lengths[lo]!;
  const f = span === 0 ? 0 : (s - lengths[lo]!) / span;
  const a = points[lo]!;
  const b = points[hi]!;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

function indexOfMin(points: Point[], score: (p: Point) => number): number {
  let best = 0;
  points.forEach((p, i) => {
    if (score(p) < score(points[best]!)) best = i;
  });
  return best;
}

function catmullRomLoop(points: Point[], samples: number): Point[] {
  const n = points.length;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    const p3 = points[(i + 2) % n]!;
    for (let k = 0; k < samples; k++) {
      const t = k / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      const along = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: along(p0.x, p1.x, p2.x, p3.x), y: along(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
}
