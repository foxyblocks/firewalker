// Runs a recipe one frame at a time using fused tilt, stomps, live audio level, and elapsed
// time. It draws every layer into one frame of pixel colors and mirrors the firmware's
// Pattern interface (include/patterns/pattern.h). The pool and down-point
// trail math are ports of src/patterns/flow.cpp, so a future C++ engine can be checked against
// this one frame for frame.
//
// Colors are 0..1 per channel, before the boot's global brightness. Nothing allocates per
// frame, and randomness comes from a seeded generator, so a run is repeatable.

import { parsePalette, samplePalette, type Rgb } from "./palette";
import { foreAft, heelToToeLength, toeToHeelLength, wrapIndex, type StripLayout } from "./strip";
import { STOMP_FADE, WAVE_PERIOD } from "../recipe/spec";
import {
  isBinding,
  type BandLayer,
  type Binding,
  type ChaseLayer,
  type FillLayer,
  type FlashLayer,
  type Knob,
  type Layer,
  type PoolLayer,
  type Recipe,
  type SparkleLayer,
  type TrailLayer,
  type Trigger,
} from "../recipe/types";

export interface EngineInput {
  tiltFwd: number; // -1 heel pose, 0 level, +1 toe pose
  stomp: boolean; // a stomp fired since the previous frame
  stompStrength: number; // 0..1, valid when stomp is true
  audioLevel?: number; // 0..1 from the audio meter; omitted inputs act as silence
  dt: number; // ms since the previous frame
}

const MAX_FRONTS = 16;
const RNG_SEED = 0x9e3779b9;
const MAX_DT_MS = 250;

interface Front {
  active: boolean;
  head: number;
  dir: number;
  lo: number;
  hi: number;
  speed: number;
  bright: number;
}

type LayerState =
  | { type: "fill"; phase: number }
  | { type: "pool" }
  | { type: "band" }
  | { type: "trail"; fronts: Front[] }
  | { type: "flash"; remainMs: number; bright: number }
  | { type: "sparkle"; level: Float32Array; hue: Float32Array; pending: number }
  | { type: "chase"; position: number; progress: number; dir: number };

export class RecipeEngine {
  readonly frame: Float32Array;

  private recipe: Recipe;
  private readonly layout: StripLayout;
  private readonly positions: Float32Array;
  private readonly layerColor: Float32Array;
  private readonly layerAlpha: Float32Array;
  private readonly scratch = new Float32Array(3);
  private palettes: Rgb[][] = [];
  private states: LayerState[] = [];

  private timeMs = 0;
  private tilt = 0;
  private audioLevel = 0;
  private lastStrength = 0;
  private sinceStompMs = Number.POSITIVE_INFINITY;
  private rng = RNG_SEED;

  constructor(recipe: Recipe, layout: StripLayout) {
    this.recipe = recipe;
    this.layout = layout;
    this.frame = new Float32Array(layout.count * 3);
    this.layerColor = new Float32Array(layout.count * 3);
    this.layerAlpha = new Float32Array(layout.count);
    this.positions = new Float32Array(layout.count);
    for (let i = 0; i < layout.count; i++) this.positions[i] = foreAft(i, layout);
    this.setRecipe(recipe);
  }

  get pixelCount(): number {
    return this.layout.count;
  }

  // Starts the pattern fresh, as when a boot switches to it.
  enter(): void {
    this.timeMs = 0;
    this.tilt = 0;
    this.audioLevel = 0;
    this.lastStrength = 0;
    this.sinceStompMs = Number.POSITIVE_INFINITY;
    this.rng = RNG_SEED;
    this.states = this.recipe.layers.map((layer) => this.freshState(layer));
    this.frame.fill(0);
  }

  // Swaps in an edited recipe. Layers that kept their type keep their running state, so a
  // knob change doesn't cut off trails already on the strip.
  setRecipe(recipe: Recipe): void {
    const previous = this.recipe.layers;
    this.recipe = recipe;
    this.palettes = recipe.layers.map((layer) => ("palette" in layer ? parsePalette(layer.palette) : []));
    this.states = recipe.layers.map((layer, i) => {
      const state = this.states[i];
      return state && previous[i]?.type === layer.type ? state : this.freshState(layer);
    });
  }

  update(input: EngineInput): void {
    // A long stall counts as MAX_DT_MS, so one frame can't do unbounded work. The firmware does the same.
    const dt = Math.min(MAX_DT_MS, Math.max(0, input.dt));
    this.timeMs += dt;
    this.sinceStompMs += dt;
    this.tilt = Math.max(-1, Math.min(1, input.tiltFwd));
    // Audio is a live value, so a missing input clears it instead of holding the
    // last loud frame. Motion-only callers and reference recordings stay silent.
    const audioLevel = input.audioLevel ?? 0;
    this.audioLevel = Number.isFinite(audioLevel) ? clamp01(audioLevel) : 0;
    if (input.stomp) {
      this.lastStrength = Math.max(0, Math.min(1, input.stompStrength));
      this.sinceStompMs = 0;
    }

    this.frame.fill(0);
    this.recipe.layers.forEach((layer, i) => {
      const state = this.states[i];
      if (!state) return;
      const fired = input.stomp && this.triggerMatches("trigger" in layer ? layer.trigger : "any");
      // Layers keep running while hidden, so showing one again doesn't restart it.
      this.layerAlpha.fill(0);
      this.drawLayer(layer, state, this.palettes[i] ?? [], fired, dt);
      if (layer.enabled) this.composite(layer);
    });
  }

  // The current value of a knob, from its source if it has one.
  knob(knob: Knob): number {
    if (!isBinding(knob)) return knob;
    return knob.min + (knob.max - knob.min) * this.sourceValue(knob);
  }

  private sourceValue(binding: Binding): number {
    switch (binding.source) {
      case "tilt":
        return (this.tilt + 1) / 2;
      case "tiltAmount":
        return Math.abs(this.tilt);
      case "audioLevel":
        return this.audioLevel;
      case "stompStrength":
        return this.lastStrength;
      case "stompFade": {
        const fade = binding.fadeMs ?? STOMP_FADE.default;
        return this.sinceStompMs >= fade ? 0 : 1 - this.sinceStompMs / fade;
      }
      case "wave": {
        const period = binding.periodMs ?? WAVE_PERIOD.default;
        return 0.5 - 0.5 * Math.cos((2 * Math.PI * (this.timeMs % period)) / period);
      }
    }
  }

  private triggerMatches(trigger: Trigger): boolean {
    if (trigger === "flat") return this.tilt === 0;
    if (trigger === "tilted") return this.tilt !== 0;
    return true;
  }

  private freshState(layer: Layer): LayerState {
    switch (layer.type) {
      case "fill":
        return { type: "fill", phase: 0 };
      case "pool":
        return { type: "pool" };
      case "band":
        return { type: "band" };
      case "trail":
        return { type: "trail", fronts: Array.from({ length: MAX_FRONTS }, () => idleFront()) };
      case "flash":
        return { type: "flash", remainMs: 0, bright: 0 };
      case "sparkle":
        return {
          type: "sparkle",
          level: new Float32Array(this.layout.count),
          hue: new Float32Array(this.layout.count),
          pending: 0,
        };
      case "chase":
        return { type: "chase", position: 0, progress: 0, dir: 1 };
    }
  }

  private drawLayer(layer: Layer, state: LayerState, palette: Rgb[], fired: boolean, dt: number): void {
    switch (layer.type) {
      case "fill":
        if (state.type === "fill") this.drawFill(layer, state, palette, dt);
        return;
      case "pool":
        this.drawPool(layer);
        return;
      case "band":
        this.drawBand(layer);
        return;
      case "trail":
        if (state.type === "trail") this.drawTrail(layer, state, palette, fired, dt);
        return;
      case "flash":
        if (state.type === "flash") this.drawFlash(layer, state, palette, fired, dt);
        return;
      case "sparkle":
        if (state.type === "sparkle") this.drawSparkle(layer, state, palette, dt);
        return;
      case "chase":
        if (state.type === "chase") this.drawChase(layer, state, palette, dt);
        return;
    }
  }

  private drawFill(layer: FillLayer, state: { phase: number }, palette: Rgb[], dt: number): void {
    state.phase += (this.knob(layer.scroll) * dt) / 1000;
    state.phase -= Math.floor(state.phase);
    const base = this.knob(layer.offset) + state.phase;
    const repeat = this.knob(layer.repeat);
    const bright = clamp01(this.knob(layer.brightness));
    const count = this.layout.count;
    for (let i = 0; i < count; i++) {
      const along = layer.spread === "ring" ? i / count : layer.spread === "foot" ? this.positions[i]! : 0;
      this.paint(i, palette, base + along * repeat, true, bright, 1);
    }
  }

  // Flow's fill gauge. `at` is both how far the fill edge has moved and how far the survivors
  // brighten toward full; each pixel fades across a one-pixel span as the edge passes. With
  // uneven arcs the span comes from the longer one, so one pixel still survives at full tilt.
  private drawPool(layer: PoolLayer): void {
    const baseline = clamp01(this.knob(layer.baseline));
    const at = Math.abs(this.tilt);
    const toeDown = this.tilt >= 0;
    const pixelSpan = 1 / Math.max(toeToHeelLength(this.layout), heelToToeLength(this.layout));
    const litBright = baseline + at * (1 - baseline);
    for (let i = 0; i < this.layout.count; i++) {
      const s = this.positions[i]!;
      const lit = clamp01(toeDown ? (s - at) / pixelSpan + 1 : (1 - at - s) / pixelSpan + 1);
      const b = lit * litBright;
      this.layerColor[i * 3] = this.layerColor[i * 3 + 1] = this.layerColor[i * 3 + 2] = b;
      this.layerAlpha[i] = 1;
    }
  }

  /**
   * Masks the fill to one interval on both foot arcs. Position divides the unused
   * space around the bar, so a half-width bar slides from [0, 0.5] at the heel,
   * through [0.25, 0.75] when centered, to [0.5, 1] at the toe. Width stays fixed
   * throughout that movement. A full-width bar fills the ring at every position.
   */
  private drawBand(layer: BandLayer): void {
    const width = clamp01(this.knob(layer.width));
    const start = (1 - width) * clamp01(this.knob(layer.position));
    const end = start + width;
    const halfPixel = 0.5 / Math.max(toeToHeelLength(this.layout), heelToToeLength(this.layout));

    for (let i = 0; i < this.layout.count; i++) {
      // Fractional coverage softens the moving edges by one pixel. Clip the
      // endpoint cells at heel/toe so silence is fully off and full width fully on.
      const s = this.positions[i]!;
      const pixelStart = Math.max(0, s - halfPixel);
      const pixelEnd = Math.min(1, s + halfPixel);
      const overlap = Math.max(0, Math.min(end, pixelEnd) - Math.max(start, pixelStart));
      const coverage = clamp01(overlap / (pixelEnd - pixelStart));
      this.layerColor[i * 3] = this.layerColor[i * 3 + 1] = this.layerColor[i * 3 + 2] = coverage;
      // Paint the dark part too, so multiply clears every pixel outside the band.
      this.layerAlpha[i] = 1;
    }
  }

  private drawTrail(layer: TrailLayer, state: { fronts: Front[] }, palette: Rgb[], fired: boolean, dt: number): void {
    const fronts = state.fronts;
    const length = Math.max(1, Math.round(layer.length));
    if (fired) {
      const speed = Math.max(0, this.knob(layer.speed));
      const bright = clamp01(this.knob(layer.brightness));
      const limit = Math.min(MAX_FRONTS, Math.max(1, layer.maxFronts));
      for (const spawn of this.trailSpawns(layer.from, layer.flatZone)) {
        const slot = fronts.findIndex((f, k) => k < limit && !f.active);
        if (slot < 0) break;
        fronts[slot] = { active: true, speed, bright, ...spawn };
      }
    }

    for (const front of fronts) {
      if (!front.active) continue;
      front.head += (front.dir * front.speed * dt) / 1000;
      if (front.dir > 0 && front.head > front.hi + length) front.active = false;
      if (front.dir < 0 && front.head < front.lo - length) front.active = false;
    }

    const count = this.layout.count;
    for (const front of fronts) {
      if (!front.active) continue;
      for (let d = 0; d < length; d++) {
        const p = Math.round(front.head - front.dir * d);
        if (p < front.lo || p > front.hi) continue;
        const u = length <= 1 ? 0 : d / (length - 1);
        this.paint(wrapIndex(p, count), palette, u, false, front.bright, 1);
      }
    }
  }

  // Where a stomp's fronts start: one source on each arc, f of the way from heel to toe, and
  // a front each way along both, skipping any with no room to move. Down point is flow's, with
  // f following the tilt. Down end is fire-trail's, with f snapped to the heel, the middle, or
  // the toe, so a trail runs from the end that's down to the other one.
  private trailSpawns(from: TrailLayer["from"], flatZone: number): Pick<Front, "head" | "dir" | "lo" | "hi">[] {
    const { toe, heel } = this.layout;
    const tilt = this.tilt;
    const f = from === "down-end" ? (tilt > flatZone ? 1 : tilt < -flatZone ? 0 : 0.5) : clamp01(0.5 + 0.5 * tilt);
    const toeToHeel = toeToHeelLength(this.layout);
    const heelToToe = heelToToeLength(this.layout);
    const farHeel = toe + toeToHeel;
    const farToe = heel + heelToToe;
    const srcA = farHeel - f * toeToHeel;
    const srcB = heel + f * heelToToe;
    const candidates = [
      { head: srcA, dir: -1, lo: toe, hi: farHeel },
      { head: srcA, dir: 1, lo: toe, hi: farHeel },
      { head: srcB, dir: -1, lo: heel, hi: farToe },
      { head: srcB, dir: 1, lo: heel, hi: farToe },
    ];
    return candidates.filter((c) => (c.dir > 0 ? c.head < c.hi - 0.5 : c.head > c.lo + 0.5));
  }

  private drawFlash(layer: FlashLayer, state: { remainMs: number; bright: number }, palette: Rgb[], fired: boolean, dt: number): void {
    const fade = Math.max(1, layer.fadeMs);
    if (fired) {
      state.remainMs = fade;
      state.bright = clamp01(this.knob(layer.brightness));
    }
    const level = clamp01(state.remainMs / fade);
    if (level > 0) {
      for (let i = 0; i < this.layout.count; i++) this.paint(i, palette, 1 - level, false, state.bright, level);
    }
    state.remainMs = Math.max(0, state.remainMs - dt);
  }

  private drawSparkle(
    layer: SparkleLayer,
    state: { level: Float32Array; hue: Float32Array; pending: number },
    palette: Rgb[],
    dt: number,
  ): void {
    const count = this.layout.count;
    const decay = dt / Math.max(1, layer.fadeMs);
    for (let i = 0; i < count; i++) state.level[i] = Math.max(0, state.level[i]! - decay);

    state.pending += (Math.max(0, this.knob(layer.density)) * dt) / 1000;
    while (state.pending >= 1) {
      state.pending -= 1;
      const i = this.nextRandom() % count;
      state.level[i] = 1;
      state.hue[i] = this.nextRandom() / 0x100000000;
    }

    const bright = clamp01(this.knob(layer.brightness));
    for (let i = 0; i < count; i++) {
      const level = state.level[i]!;
      if (level > 0) this.paint(i, palette, state.hue[i]!, false, bright, level);
    }
  }

  private drawChase(
    layer: ChaseLayer,
    state: { position: number; progress: number; dir: number },
    palette: Rgb[],
    dt: number,
  ): void {
    const count = this.layout.count;
    const speed = this.knob(layer.speed);
    if (speed !== 0) state.dir = speed > 0 ? 1 : -1;
    const comets = Math.max(1, Math.round(layer.count));
    const length = Math.max(1, Math.round(layer.length));
    const bright = clamp01(this.knob(layer.brightness));
    if (layer.path === "foot") {
      this.drawFootChase(state, Math.abs(speed), comets, length, bright, palette, dt);
      return;
    }

    state.position = wrapIndex(state.position + (speed * dt) / 1000, count);
    for (let k = 0; k < comets; k++) {
      const head = state.position + (k * count) / comets;
      // Tail first, so a head that overlaps another comet's tail stays on top.
      for (let d = length - 1; d >= 0; d--) {
        const p = wrapIndex(Math.round(head - state.dir * d), count);
        const u = length <= 1 ? 0 : d / (length - 1);
        this.paint(p, palette, u, false, bright, 1 - d / length);
      }
    }
  }

  // Comets that run up both sides of the foot side by side, heel to toe, or toe to heel when
  // the speed is negative. Progress counts pixels along an average side from the starting end,
  // and each lap is a comet's length longer than a side, so its tail leaves the far end before
  // it comes back in at the start.
  private drawFootChase(
    state: { progress: number; dir: number },
    speed: number,
    comets: number,
    length: number,
    bright: number,
    palette: Rgb[],
    dt: number,
  ): void {
    const { count, toe, heel } = this.layout;
    const toeToHeel = toeToHeelLength(this.layout);
    const heelToToe = heelToToeLength(this.layout);
    const side = count / 2;
    const lap = side + length;
    state.progress = wrapIndex(state.progress + (speed * dt) / 1000, lap);
    for (let k = 0; k < comets; k++) {
      const head = (state.progress + (k * lap) / comets) % lap;
      for (let d = length - 1; d >= 0; d--) {
        const along = (head - d) / side;
        if (along < 0 || along > 1) continue;
        const s = state.dir > 0 ? along : 1 - along;
        const u = length <= 1 ? 0 : d / (length - 1);
        const alpha = 1 - d / length;
        this.paint(wrapIndex(heel + Math.round(s * heelToToe), count), palette, u, false, bright, alpha);
        this.paint(wrapIndex(toe + Math.round((1 - s) * toeToHeel), count), palette, u, false, bright, alpha);
      }
    }
  }

  // Sets one pixel of the current layer to the palette color at u, scaled by bright.
  private paint(i: number, palette: Rgb[], u: number, loop: boolean, bright: number, alpha: number): void {
    samplePalette(palette, u, loop, this.scratch, 0);
    const at = i * 3;
    this.layerColor[at] = this.scratch[0]! * bright;
    this.layerColor[at + 1] = this.scratch[1]! * bright;
    this.layerColor[at + 2] = this.scratch[2]! * bright;
    this.layerAlpha[i] = alpha;
  }

  private composite(layer: Layer): void {
    const opacity = clamp01(this.knob(layer.opacity));
    if (opacity === 0) return;
    const frame = this.frame;
    for (let i = 0; i < this.layout.count; i++) {
      const a = this.layerAlpha[i]! * opacity;
      if (a === 0) continue;
      for (let c = 0; c < 3; c++) {
        const at = i * 3 + c;
        const below = frame[at]!;
        const color = this.layerColor[at]!;
        switch (layer.blend) {
          case "over":
            frame[at] = below + (color - below) * a;
            break;
          case "add":
            frame[at] = Math.min(1, below + color * a);
            break;
          case "max":
            frame[at] = Math.max(below, color * a);
            break;
          case "multiply":
            frame[at] = below * (1 - a + color * a);
            break;
        }
      }
    }
  }

  // xorshift32: small, fast, and easy to match in C++.
  private nextRandom(): number {
    let x = this.rng;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.rng = x;
    return x;
  }
}

function idleFront(): Front {
  return { active: false, head: 0, dir: 1, lo: 0, hi: 0, speed: 0, bright: 0 };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
