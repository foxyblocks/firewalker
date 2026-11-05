// Canvas drawing for the simulator's three views: the boot from above, the boot from the
// outer side (tilting with the slider), and the strip laid flat in index order.

import { SIDE_BOX, SIDE_GROUND_Y, TOP_BOX, type Point, type SideGeometry, type TopGeometry } from "./bootGeometry";
import type { StripLayout } from "../engine/strip";

const COLORS = {
  sole: "#1d1a17",
  soleEdge: "#3a352f",
  upper: "#151311",
  upperEdge: "#2e2a25",
  ground: "#2e2a25",
  unlit: "#2a2622",
  controller: "#4a443c",
  label: "#6f675e",
};

// LEDs emit light linearly in their PWM value, but a screen expects gamma-encoded values.
// Without this, dim pixels look darker on screen than on the boot.
const DISPLAY_GAMMA = 1 / 2.2;
// How far a tilt of 1 rotates the side view.
const MAX_SIDE_ANGLE_DEG = 20;

// Matches a canvas's pixel size to its CSS size, so lines stay sharp on retina screens.
export function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return canvas.getContext("2d");
}

interface Fit {
  scale: number;
  dx: number;
  dy: number;
}

function fitBox(width: number, height: number, box: { width: number; height: number }, padding: number): Fit {
  const scale = Math.min((width - 2 * padding) / box.width, (height - 2 * padding) / box.height);
  return { scale, dx: (width - box.width * scale) / 2, dy: (height - box.height * scale) / 2 };
}

function displayColor(frame: Float32Array, i: number): { css: string; level: number } {
  const r = Math.pow(Math.max(0, frame[i * 3]!), DISPLAY_GAMMA);
  const g = Math.pow(Math.max(0, frame[i * 3 + 1]!), DISPLAY_GAMMA);
  const b = Math.pow(Math.max(0, frame[i * 3 + 2]!), DISPLAY_GAMMA);
  return {
    css: `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`,
    level: Math.max(r, g, b),
  };
}

// Draws pixels as glowing dots: a soft additive halo, then a solid core.
function drawLeds(ctx: CanvasRenderingContext2D, frame: Float32Array, points: { index: number; point: Point }[], radius: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const { index, point } of points) {
    const { css, level } = displayColor(frame, index);
    if (level < 0.02) continue;
    const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 4.5);
    glow.addColorStop(0, css);
    glow.addColorStop(1, "rgb(0 0 0 / 0)");
    ctx.globalAlpha = 0.55 * level;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  for (const { index, point } of points) {
    const { css, level } = displayColor(frame, index);
    ctx.fillStyle = level < 0.02 ? COLORS.unlit : css;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function tracePath(ctx: CanvasRenderingContext2D, points: Point[], inset = 0, center?: Point): void {
  ctx.beginPath();
  points.forEach((p, i) => {
    let x = p.x;
    let y = p.y;
    if (inset && center) {
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const d = Math.hypot(dx, dy) || 1;
      x -= (dx / d) * inset;
      y -= (dy / d) * inset;
    }
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

export function drawTopView(canvas: HTMLCanvasElement, frame: Float32Array, geometry: TopGeometry, labels = true): void {
  const ctx = fitCanvas(canvas);
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const fit = fitBox(width, height, TOP_BOX, Math.min(width, height) * 0.08);
  ctx.setTransform(fit.scale, 0, 0, fit.scale, fit.dx, fit.dy);
  const line = 1 / fit.scale;
  const center = { x: 130, y: 330 };

  ctx.fillStyle = COLORS.sole;
  ctx.strokeStyle = COLORS.soleEdge;
  ctx.lineWidth = 1.5 * line;
  tracePath(ctx, geometry.outline, 10, center);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = COLORS.upper;
  ctx.strokeStyle = COLORS.upperEdge;
  tracePath(ctx, geometry.outline, 34, center);
  ctx.fill();
  ctx.stroke();

  // The controller, clipped on the outer side over pixel 0.
  const c = geometry.controller;
  ctx.fillStyle = COLORS.controller;
  ctx.beginPath();
  ctx.roundRect(c.x - 30, c.y - 16, 20, 32, 4);
  ctx.fill();

  if (labels) {
    ctx.fillStyle = COLORS.label;
    ctx.font = '13px "Spline Sans Mono Variable", monospace';
    ctx.textAlign = "center";
    ctx.fillText("TOE", 130, 70);
    ctx.fillText("HEEL", 130, 590);
  }

  drawLeds(
    ctx,
    frame,
    geometry.pixels.map((point, index) => ({ index, point })),
    4.2,
  );
}

const BOOT_UPPER: Point[] = [
  { x: 58, y: 274 },
  { x: 56, y: 62 },
  { x: 64, y: 44 },
  { x: 82, y: 40 },
  { x: 190, y: 40 },
  { x: 204, y: 48 },
  { x: 207, y: 62 },
  { x: 212, y: 150 },
  { x: 230, y: 186 },
  { x: 300, y: 205 },
  { x: 450, y: 222 },
  { x: 505, y: 236 },
  { x: 532, y: 256 },
  { x: 538, y: 274 },
];

export function drawSideView(canvas: HTMLCanvasElement, frame: Float32Array, geometry: SideGeometry, tilt: number): void {
  const ctx = fitCanvas(canvas);
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const fit = fitBox(width, height, SIDE_BOX, Math.min(width, height) * 0.06);
  ctx.setTransform(fit.scale, 0, 0, fit.scale, fit.dx, fit.dy);
  const line = 1 / fit.scale;

  ctx.strokeStyle = COLORS.ground;
  ctx.lineWidth = 1.5 * line;
  ctx.beginPath();
  ctx.moveTo(0, SIDE_GROUND_Y);
  ctx.lineTo(SIDE_BOX.width, SIDE_GROUND_Y);
  ctx.stroke();

  // Toe down pivots on the toe, heel down on the heel, the way a foot rolls.
  const pivot = tilt >= 0 ? geometry.toeContact : geometry.heelContact;
  const angle = (tilt * MAX_SIDE_ANGLE_DEG * Math.PI) / 180;
  ctx.translate(pivot.x, pivot.y);
  ctx.rotate(angle);
  ctx.translate(-pivot.x, -pivot.y);

  ctx.fillStyle = COLORS.upper;
  ctx.strokeStyle = COLORS.upperEdge;
  ctx.lineWidth = 1.5 * line;
  ctx.beginPath();
  BOOT_UPPER.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = COLORS.sole;
  ctx.strokeStyle = COLORS.soleEdge;
  ctx.beginPath();
  ctx.roundRect(46, 272, 498, 28, 10);
  ctx.fill();
  ctx.stroke();

  // The controller sits over pixel 0, wherever the layout puts it on this side.
  const zero = geometry.near.find((p) => p.index === 0);
  if (zero) {
    ctx.fillStyle = COLORS.controller;
    ctx.beginPath();
    ctx.roundRect(zero.point.x - 18, 236, 36, 26, 4);
    ctx.fill();
  }

  drawLeds(ctx, frame, geometry.near, 4.6);
}

export function drawStripView(canvas: HTMLCanvasElement, frame: Float32Array, layout: StripLayout): void {
  const ctx = fitCanvas(canvas);
  if (!ctx) return;
  const { width, height } = canvas;
  const ratio = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const cell = width / layout.count;
  const top = 4 * ratio;
  const size = Math.min(cell * 0.82, height - 22 * ratio);
  for (let i = 0; i < layout.count; i++) {
    const { css, level } = displayColor(frame, i);
    ctx.fillStyle = level < 0.02 ? COLORS.unlit : css;
    ctx.fillRect(i * cell + (cell - size) / 2, top, size, size);
  }

  ctx.fillStyle = COLORS.label;
  ctx.font = `${10 * ratio}px "Spline Sans Mono Variable", monospace`;
  ctx.textBaseline = "top";
  const marks: [number, string][] = [
    [0, "0 ctrl"],
    [layout.toe, `${layout.toe} toe`],
    [layout.heel, `${layout.heel} heel`],
    [layout.count - 1, `${layout.count - 1}`],
  ];
  for (const [i, text] of marks) {
    const x = i * cell + cell / 2;
    ctx.fillRect(x - ratio / 2, top + size + 2 * ratio, ratio, 4 * ratio);
    ctx.textAlign = i === 0 ? "left" : i === layout.count - 1 ? "right" : "center";
    ctx.fillText(text, i === 0 ? i * cell : i === layout.count - 1 ? width : x, top + size + 7 * ratio);
  }
}
