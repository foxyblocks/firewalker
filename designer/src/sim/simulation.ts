// Runs a recipe in the browser like a boot runs a pattern: a frame every 16 ms (APP_FRAME_MS
// in include/config.h), fed by the tilt slider, the stomp button, or a walking gait, and drawn
// to the simulator's canvases.

import { sideGeometry, topGeometry, type SideGeometry, type TopGeometry } from "./bootGeometry";
import { drawSideView, drawStripView, drawTopView } from "./draw";
import { RecipeEngine } from "../engine/engine";
import type { StripLayout } from "../engine/strip";
import type { Recipe } from "../recipe/types";

export const FRAME_MS = 16;
const MAX_STEPS_PER_TICK = 8;
const READOUT_MS = 80;

// One step of a walk, as tilt keyframes over the gait cycle: heel strike, roll to flat, toe
// off, then the swing back. The heel strike is the stomp.
const GAIT_MS = 1400;
const GAIT: [number, number][] = [
  [0, -0.6],
  [0.15, -0.6],
  [0.4, 0],
  [0.5, 0],
  [0.7, 0.8],
  [0.85, 0.2],
  [1, -0.6],
];
const GAIT_STOMP_STRENGTH = 0.6;

export interface Canvases {
  top: HTMLCanvasElement;
  side: HTMLCanvasElement;
  strip: HTMLCanvasElement;
}

export interface Readout {
  tilt: number;
  lastStomp: number | null;
  timeMs: number;
}

export class Simulation {
  private engine: RecipeEngine;
  private layout: StripLayout;
  private top: TopGeometry;
  private side: SideGeometry;
  private canvases: Canvases | null = null;

  private tilt = 0;
  private walking = false;
  private paused = false;
  private speed = 1;
  private pendingStomp: number | null = null;
  private lastStomp: number | null = null;
  private gaitMs = 0;
  private timeMs = 0;

  private frameId = 0;
  private lastTick = 0;
  private carryMs = 0;
  private lastReadout = 0;
  private listener: ((readout: Readout) => void) | null = null;

  constructor(recipe: Recipe, layout: StripLayout) {
    this.layout = layout;
    this.engine = new RecipeEngine(recipe, layout);
    this.engine.enter();
    this.top = topGeometry(layout);
    this.side = sideGeometry(layout);
  }

  start(canvases: Canvases, onReadout: (readout: Readout) => void): void {
    this.canvases = canvases;
    this.listener = onReadout;
    this.lastTick = performance.now();
    const tick = (now: number) => {
      this.tick(now);
      this.frameId = requestAnimationFrame(tick);
    };
    this.frameId = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.frameId);
    this.canvases = null;
    this.listener = null;
  }

  setRecipe(recipe: Recipe): void {
    this.engine.setRecipe(recipe);
  }

  setLayout(recipe: Recipe, layout: StripLayout): void {
    this.layout = layout;
    this.engine = new RecipeEngine(recipe, layout);
    this.engine.enter();
    this.top = topGeometry(layout);
    this.side = sideGeometry(layout);
  }

  setTilt(tilt: number): void {
    this.tilt = Math.max(-1, Math.min(1, tilt));
  }

  setWalking(walking: boolean): void {
    this.walking = walking;
    this.gaitMs = 0;
    if (!walking) this.tilt = 0;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  stomp(strength: number): void {
    this.pendingStomp = Math.max(0, Math.min(1, strength));
  }

  // Starts the pattern over, as when a boot switches to it.
  reset(): void {
    this.engine.enter();
    this.timeMs = 0;
    this.gaitMs = 0;
    this.lastStomp = null;
  }

  private tick(now: number): void {
    const elapsed = Math.min(250, now - this.lastTick);
    this.lastTick = now;
    if (!this.paused) {
      this.carryMs += elapsed * this.speed;
      let steps = 0;
      while (this.carryMs >= FRAME_MS && steps < MAX_STEPS_PER_TICK) {
        this.step();
        this.carryMs -= FRAME_MS;
        steps++;
      }
      if (steps === MAX_STEPS_PER_TICK) this.carryMs = 0;
    } else if (this.pendingStomp !== null) {
      // A stomp while paused still shows its first frame.
      this.step();
    }
    this.draw();

    if (this.listener && now - this.lastReadout >= READOUT_MS) {
      this.lastReadout = now;
      this.listener({ tilt: this.tilt, lastStomp: this.lastStomp, timeMs: this.timeMs });
    }
  }

  private step(): void {
    let stomp = this.pendingStomp;
    this.pendingStomp = null;

    if (this.walking) {
      const before = this.gaitMs;
      this.gaitMs = (this.gaitMs + FRAME_MS) % GAIT_MS;
      if (this.gaitMs < before) stomp = GAIT_STOMP_STRENGTH;
      this.tilt = gaitTilt(this.gaitMs / GAIT_MS);
    }

    if (stomp !== null) this.lastStomp = stomp;
    this.timeMs += FRAME_MS;
    this.engine.update({ tiltFwd: this.tilt, stomp: stomp !== null, stompStrength: stomp ?? 0, dt: FRAME_MS });
  }

  private draw(): void {
    if (!this.canvases) return;
    drawTopView(this.canvases.top, this.engine.frame, this.top);
    drawSideView(this.canvases.side, this.engine.frame, this.side, this.tilt);
    drawStripView(this.canvases.strip, this.engine.frame, this.layout);
  }
}

export function gaitTilt(phase: number): number {
  for (let k = 1; k < GAIT.length; k++) {
    const [p1, t1] = GAIT[k]!;
    const [p0, t0] = GAIT[k - 1]!;
    if (phase <= p1) {
      const value = t0 + ((t1 - t0) * (phase - p0)) / (p1 - p0);
      // Snap to exactly level, the way the firmware's dead zone does.
      return Math.abs(value) < 0.03 ? 0 : value;
    }
  }
  return GAIT[GAIT.length - 1]![1];
}
