// Runs a recipe in the browser like a boot runs a pattern: a frame every 16 ms (APP_FRAME_MS
// in include/config.h), fed by the tilt slider, the stomp button, a stomp on every beat, or a
// walking gait, plus the live level from AudioMonitor, and drawn to the simulator's canvases.
//
// A stomp is animated in the side view: the boot lifts and drops, and the pattern gets the
// stomp on the frame it lands, the way the boot's motion sensor feels it.

import { sideGeometry, topGeometry, type SideGeometry, type TopGeometry } from "./bootGeometry";
import { drawSideView, drawStripView, drawTopView, type SidePose } from "./draw";
import { RecipeEngine } from "../engine/engine";
import { applyBootBrightness, BOOT_BRIGHTNESS } from "../engine/output";
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
// The foot leaves the ground after toe off and comes down at the heel strike.
const GAIT_LIFT_FROM = 0.72;
const GAIT_LIFT = 34;

// A stomp's lift and drop, and how long its landing shows. Heights are in the side view's
// units, where the boot is about 260 tall.
const STOMP_RISE_MS = 90;
const STOMP_FALL_MS = 130;
const STOMP_LIFT_MIN = 24;
const STOMP_LIFT_PER_STRENGTH = 40;
const IMPACT_MS = 360;
// On a fast beat the drop shortens, so the boot still spends some of each beat on the ground.
const BEAT_DROP_SHARE = 0.7;

export interface Canvases {
  top: HTMLCanvasElement;
  side: HTMLCanvasElement;
  strip: HTMLCanvasElement;
}

export interface Readout {
  tilt: number;
  lastStomp: number | null;
  // Counts landings, so the panel can flash its stomp button on each one.
  stomps: number;
  timeMs: number;
}

export interface Drop {
  elapsedMs: number;
  riseMs: number;
  fallMs: number;
  strength: number;
}

export class Simulation {
  private engine: RecipeEngine;
  private layout: StripLayout;
  // The engine's frame after the boot's brightness setting, which is what the canvases draw.
  private shownFrame: Float32Array;
  private bootBrightness: number = BOOT_BRIGHTNESS.default;
  private top: TopGeometry;
  private side: SideGeometry;
  private canvases: Canvases | null = null;

  private tilt = 0;
  private manualTilt = 0;
  private audioLevel = 0;
  private walking = false;
  private paused = false;
  private speed = 1;
  private pendingStomp: number | null = null;
  private lastStomp: number | null = null;
  private stomps = 0;
  private gaitMs = 0;
  private timeMs = 0;

  private drop: Drop | null = null;
  private lift = 0;
  private impactMs = 0;
  private impactStrength = 0;
  private beatMs: number | null = null;
  private beatStrength = 0.7;
  private beatClockMs = 0;
  private nextBeatMs = 0;

  private frameId = 0;
  private lastTick = 0;
  private carryMs = 0;
  private lastReadout = 0;
  private listener: ((readout: Readout) => void) | null = null;

  constructor(recipe: Recipe, layout: StripLayout) {
    this.layout = layout;
    this.engine = new RecipeEngine(recipe, layout);
    this.engine.enter();
    this.shownFrame = new Float32Array(layout.count * 3);
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
    this.shownFrame = new Float32Array(layout.count * 3);
    this.top = topGeometry(layout);
    this.side = sideGeometry(layout);
  }

  setBootBrightness(brightness: number): void {
    this.bootBrightness = brightness;
  }

  // AudioMonitor sends the same 0..1 level it displays. Keep it across recipe
  // edits and layout changes, and reuse it until the next audio reading arrives.
  setAudioLevel(level: number): void {
    this.audioLevel = level;
  }

  // The slider's tilt. Walking drives the tilt itself, and stopping goes back to this.
  setTilt(tilt: number): void {
    this.manualTilt = Math.max(-1, Math.min(1, tilt));
    if (!this.walking) this.tilt = this.manualTilt;
  }

  setWalking(walking: boolean): void {
    this.walking = walking;
    this.gaitMs = 0;
    this.lift = 0;
    if (!walking) this.tilt = this.manualTilt;
  }

  // Stomps on every beat at this tempo, landing on the beat, or stops with null.
  setBeat(bpm: number | null, strength: number): void {
    this.beatStrength = clamp01(strength);
    const beatMs = bpm && bpm > 0 ? 60000 / bpm : null;
    if (beatMs === this.beatMs) return;
    this.beatMs = beatMs;
    this.beatClockMs = 0;
    // The first stomp lands as soon as the boot can get up and back down.
    this.nextBeatMs = beatMs === null ? 0 : this.dropTiming().riseMs + this.dropTiming().fallMs;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  // Lifts the boot and drops it, and the stomp lands with it. While paused it lands at once,
  // so its first frame can be looked at. A stomp while the boot is already in the air makes
  // that landing as hard as the harder of the two.
  stomp(strength: number): void {
    const s = clamp01(strength);
    if (this.paused) {
      this.pendingStomp = s;
      return;
    }
    if (this.drop) {
      this.drop.strength = Math.max(this.drop.strength, s);
      return;
    }
    this.drop = { elapsedMs: 0, ...this.dropTiming(), strength: s };
  }

  // Starts the pattern over, as when a boot switches to it.
  reset(): void {
    this.engine.enter();
    this.timeMs = 0;
    this.gaitMs = 0;
    this.lastStomp = null;
    this.drop = null;
    this.lift = 0;
    this.impactMs = 0;
    this.beatClockMs = 0;
    if (this.beatMs !== null) this.nextBeatMs = this.dropTiming().riseMs + this.dropTiming().fallMs;
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
      this.listener({ tilt: this.tilt, lastStomp: this.lastStomp, stomps: this.stomps, timeMs: this.timeMs });
    }
  }

  private step(): void {
    let stomp = this.pendingStomp;
    this.pendingStomp = null;
    const land = (strength: number) => {
      stomp = Math.max(stomp ?? 0, strength);
    };

    if (this.walking) {
      const before = this.gaitMs;
      this.gaitMs = (this.gaitMs + FRAME_MS) % GAIT_MS;
      if (this.gaitMs < before) land(GAIT_STOMP_STRENGTH);
      this.tilt = gaitTilt(this.gaitMs / GAIT_MS);
      this.lift = gaitLift(this.gaitMs / GAIT_MS) * GAIT_LIFT;
    }

    if (this.beatMs !== null) {
      this.beatClockMs += FRAME_MS;
      const { riseMs, fallMs } = this.dropTiming();
      if (this.beatClockMs >= this.nextBeatMs - riseMs - fallMs) {
        if (!this.drop) this.drop = { elapsedMs: 0, riseMs, fallMs, strength: this.beatStrength };
        this.nextBeatMs += this.beatMs;
      }
    }

    if (this.drop) {
      const drop = this.drop;
      drop.elapsedMs += FRAME_MS;
      if (drop.elapsedMs >= drop.riseMs + drop.fallMs) {
        land(drop.strength);
        this.drop = null;
        this.lift = 0;
      } else {
        this.lift = (STOMP_LIFT_MIN + STOMP_LIFT_PER_STRENGTH * drop.strength) * dropHeight(drop);
      }
    }

    if (stomp !== null) {
      this.lastStomp = stomp;
      this.stomps++;
      this.impactMs = IMPACT_MS;
      this.impactStrength = stomp;
    } else {
      this.impactMs = Math.max(0, this.impactMs - FRAME_MS);
    }
    this.timeMs += FRAME_MS;
    this.engine.update({
      tiltFwd: this.tilt,
      stomp: stomp !== null,
      stompStrength: stomp ?? 0,
      audioLevel: this.audioLevel,
      dt: FRAME_MS,
    });
  }

  // How long a stomp's lift and drop take, shortened to fit a fast beat.
  private dropTiming(): { riseMs: number; fallMs: number } {
    const full = STOMP_RISE_MS + STOMP_FALL_MS;
    const scale = this.beatMs === null ? 1 : Math.min(1, (this.beatMs * BEAT_DROP_SHARE) / full);
    return { riseMs: STOMP_RISE_MS * scale, fallMs: STOMP_FALL_MS * scale };
  }

  private draw(): void {
    if (!this.canvases) return;
    const pose: SidePose = {
      tilt: this.tilt,
      lift: this.lift,
      impact: this.impactMs / IMPACT_MS,
      impactStrength: this.impactStrength,
    };
    applyBootBrightness(this.engine.frame, this.bootBrightness, this.shownFrame);
    drawTopView(this.canvases.top, this.shownFrame, this.top);
    drawSideView(this.canvases.side, this.shownFrame, this.side, pose);
    drawStripView(this.canvases.strip, this.shownFrame, this.layout);
  }
}

// The boot's height through a drop, from 0 to 1: a quick rise that slows at the top, then a
// fall that speeds up like it's under gravity.
export function dropHeight(drop: Drop): number {
  if (drop.elapsedMs < drop.riseMs) {
    const t = drop.elapsedMs / drop.riseMs;
    return 1 - (1 - t) * (1 - t);
  }
  const t = Math.min(1, (drop.elapsedMs - drop.riseMs) / drop.fallMs);
  return 1 - t * t;
}

// The foot's height through a walking step, from 0 to 1: off the ground from just after toe
// off until the heel strike.
export function gaitLift(phase: number): number {
  if (phase < GAIT_LIFT_FROM) return 0;
  return Math.sin((Math.PI * (phase - GAIT_LIFT_FROM)) / (1 - GAIT_LIFT_FROM));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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
