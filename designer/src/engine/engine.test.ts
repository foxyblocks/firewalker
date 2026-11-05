import { describe, expect, it } from "vitest";

import { RecipeEngine, type EngineInput } from "./engine";
import { samplePalette, parsePalette } from "./palette";
import { BENCH_STRIP, BOOT_3EB5, BOOT_3ED8, foreAft, heelToToeLength, layoutProblem, onOuterArc, toeToHeelLength, type StripLayout } from "./strip";
import { newLayer } from "../recipe/spec";
import type { Layer, Recipe, TrailLayer } from "../recipe/types";

const FRAME_MS = 16;
// A ring that runs toe first, with even arcs of 55 steps, so the numbers below stay readable.
const RING: StripLayout = { count: 110, toe: 36, heel: 91 };
// A ring like a real boot's that runs heel first, with uneven arcs. It's written out here, so the numbers
// below don't change when a boot is re-cut.
const HEEL_FIRST: StripLayout = { count: 107, toe: 72, heel: 19 };

function recipe(...layers: Layer[]): Recipe {
  return { format: "firewalker-recipe", version: 1, name: "test", description: "", layers };
}

function layer<T extends Layer>(type: T["type"], overrides: Partial<T> = {}): T {
  return { ...(newLayer(type) as T), ...overrides };
}

function step(engine: RecipeEngine, input: Partial<EngineInput> = {}): void {
  engine.update({ tiltFwd: 0, stomp: false, stompStrength: 0, dt: FRAME_MS, ...input });
}

function pixel(engine: RecipeEngine, i: number): number[] {
  return Array.from(engine.frame.slice(i * 3, i * 3 + 3)).map((v) => Math.round(v * 1000) / 1000);
}

function lit(engine: RecipeEngine): number[] {
  const indices: number[] = [];
  for (let i = 0; i < engine.pixelCount; i++) {
    if (engine.frame[i * 3]! + engine.frame[i * 3 + 1]! + engine.frame[i * 3 + 2]! > 0.001) indices.push(i);
  }
  return indices;
}

describe("strip map", () => {
  it("matches the firmware's fore-aft map on the bench strip", () => {
    expect(foreAft(BENCH_STRIP.toe, BENCH_STRIP)).toBe(1);
    expect(foreAft(BENCH_STRIP.heel, BENCH_STRIP)).toBe(0);
    expect(foreAft(0, BENCH_STRIP)).toBeCloseTo(28 / 80);
    expect(foreAft(92, BENCH_STRIP)).toBeCloseTo(0.5);
  });

  it("runs either way round: the boots put the heel before the toe", () => {
    expect(toeToHeelLength(HEEL_FIRST)).toBe(54);
    expect(heelToToeLength(HEEL_FIRST)).toBe(53);
    expect(foreAft(HEEL_FIRST.toe, HEEL_FIRST)).toBe(1);
    expect(foreAft(HEEL_FIRST.heel, HEEL_FIRST)).toBe(0);
    // Pixel 0 is 35 steps on from the toe, on the arc that crosses the seam.
    expect(foreAft(0, HEEL_FIRST)).toBeCloseTo(19 / 54);
    expect(foreAft(45, HEEL_FIRST)).toBeCloseTo(26 / 53);
  });

  it("puts the arc through pixel 0 on the outer side", () => {
    expect(onOuterArc(0, HEEL_FIRST)).toBe(true);
    expect(onOuterArc(100, HEEL_FIRST)).toBe(true);
    expect(onOuterArc(45, HEEL_FIRST)).toBe(false);
    expect(onOuterArc(0, RING)).toBe(true);
    expect(onOuterArc(60, RING)).toBe(false);
  });

  it("accepts the boot and bench layouts, and rejects a toe and heel on one pixel", () => {
    for (const layout of [RING, HEEL_FIRST, BOOT_3EB5, BOOT_3ED8, BENCH_STRIP]) expect(layoutProblem(layout)).toBeNull();
    expect(layoutProblem({ count: 110, toe: 36, heel: 36 })).not.toBeNull();
    expect(layoutProblem({ count: 110, toe: 36, heel: 110 })).not.toBeNull();
  });
});

describe("palette", () => {
  const out = new Float32Array(3);
  const redBlue = parsePalette(["#ff0000", "#0000ff"]);

  it("loops so the last stop blends back into the first", () => {
    samplePalette(redBlue, 0.5, true, out, 0);
    expect(Array.from(out)).toEqual([0, 0, 1]);
    samplePalette(redBlue, 0.75, true, out, 0);
    expect(Array.from(out)).toEqual([0.5, 0, 0.5]);
    samplePalette(redBlue, 1.25, true, out, 0);
    expect(Array.from(out)).toEqual([0.5, 0, 0.5]);
  });

  it("reads start to end with clamping", () => {
    samplePalette(redBlue, 1, false, out, 0);
    expect(Array.from(out)).toEqual([0, 0, 1]);
    samplePalette(redBlue, -3, false, out, 0);
    expect(Array.from(out)).toEqual([1, 0, 0]);
  });
});

describe("fill", () => {
  it("scrolls a solid color through the palette", () => {
    const engine = new RecipeEngine(
      recipe(layer("fill", { palette: ["#ff0000", "#0000ff"], spread: "solid", scroll: 1 })),
      RING,
    );
    engine.enter();
    engine.update({ tiltFwd: 0, stomp: false, stompStrength: 0, dt: 250 });
    engine.update({ tiltFwd: 0, stomp: false, stompStrength: 0, dt: 250 });
    expect(pixel(engine, 0)).toEqual([0, 0, 1]);
    expect(pixel(engine, 77)).toEqual([0, 0, 1]);
  });

  it("counts a long stall as 250 ms, like the firmware", () => {
    const fill = recipe(layer("fill", { palette: ["#ff0000", "#0000ff"], spread: "solid", scroll: 1 }));
    const stalled = new RecipeEngine(fill, RING);
    const capped = new RecipeEngine(fill, RING);
    stalled.enter();
    capped.enter();
    stalled.update({ tiltFwd: 0, stomp: false, stompStrength: 0, dt: 5000 });
    capped.update({ tiltFwd: 0, stomp: false, stompStrength: 0, dt: 250 });
    expect(pixel(stalled, 0)).toEqual(pixel(capped, 0));
  });

  it("lays a two-color gradient heel to toe at repeat 0.5", () => {
    const engine = new RecipeEngine(
      recipe(layer("fill", { palette: ["#ff0000", "#0000ff"], spread: "foot", scroll: 0, repeat: 0.5 })),
      RING,
    );
    engine.enter();
    step(engine, { dt: 0 });
    expect(pixel(engine, RING.heel)).toEqual([1, 0, 0]);
    expect(pixel(engine, RING.toe)).toEqual([0, 0, 1]);
  });

  it("follows a knob bound to tilt", () => {
    const engine = new RecipeEngine(
      recipe(layer("fill", { palette: ["#ffffff"], scroll: 0, brightness: { source: "tilt", min: 0, max: 1 } })),
      RING,
    );
    engine.enter();
    step(engine, { tiltFwd: -1 });
    expect(pixel(engine, 0)).toEqual([0, 0, 0]);
    step(engine, { tiltFwd: 1 });
    expect(pixel(engine, 0)).toEqual([1, 1, 1]);
  });
});

describe("pool", () => {
  const white = layer("fill", { palette: ["#ffffff"], scroll: 0 });

  it("glows every pixel at the baseline when flat", () => {
    const engine = new RecipeEngine(recipe(white, layer("pool", { baseline: 0.8 })), RING);
    engine.enter();
    step(engine);
    expect(lit(engine)).toHaveLength(RING.count);
    expect(pixel(engine, 10)).toEqual([0.8, 0.8, 0.8]);
  });

  it("drains to one full pixel at the toe at full toe-down tilt", () => {
    const engine = new RecipeEngine(recipe(white, layer("pool")), RING);
    engine.enter();
    step(engine, { tiltFwd: 1 });
    expect(lit(engine)).toEqual([RING.toe]);
    expect(pixel(engine, RING.toe)).toEqual([1, 1, 1]);
  });

  it("drains toward the heel when heel-down", () => {
    const engine = new RecipeEngine(recipe(white, layer("pool")), RING);
    engine.enter();
    step(engine, { tiltFwd: -1 });
    expect(lit(engine)).toEqual([RING.heel]);
  });
});

describe("trail", () => {
  it("launches four diverging fronts from the down point on a tilted stomp", () => {
    const engine = new RecipeEngine(
      recipe(layer("trail", { trigger: "tilted", length: 1, speed: 0, brightness: 1 })),
      RING,
    );
    engine.enter();
    step(engine, { tiltFwd: 0.5, stomp: true, stompStrength: 1 });
    // f = 0.75: srcA = 91 - 0.75 * 55 and srcB = 91 + 0.75 * 55, folded past the last pixel.
    expect(lit(engine)).toEqual([[50], [(91 + 41) % 110]].flat().sort((a, b) => a - b));
  });

  it("ignores a flat stomp when it only fires on tilted ones", () => {
    const engine = new RecipeEngine(recipe(layer("trail", { trigger: "tilted" })), RING);
    engine.enter();
    step(engine, { tiltFwd: 0, stomp: true, stompStrength: 1 });
    expect(lit(engine)).toEqual([]);
  });

  // Down end on 3EB5: toe 72, heel 19, arcs of 54 (toe to heel) and 53 (heel to toe).
  function downEnd(tiltFwd: number): RecipeEngine {
    const engine = new RecipeEngine(
      recipe(layer("trail", { from: "down-end", trigger: "any", length: 1, speed: 1000, brightness: 1 })),
      HEEL_FIRST,
    );
    engine.enter();
    engine.update({ tiltFwd, stomp: true, stompStrength: 1, dt: 10 });
    return engine;
  }

  it("runs down-end fronts from the toe along both sides when the toe is down", () => {
    expect(lit(downEnd(0.8))).toEqual([62, 82]);
  });

  it("runs down-end fronts from the heel when the heel is down, across the seam", () => {
    // One leaves 19 climbing; the other leaves 19 falling, through 0 to 106 and on.
    expect(lit(downEnd(-0.8))).toEqual([9, 29]);
  });

  it("runs four down-end fronts out from the middle of each side inside the flat zone", () => {
    // Sides start at 72 + 27 = 99 and 19 + 26.5 = 45.5, and each sends a front both ways.
    expect(lit(downEnd(0.1))).toEqual([2, 36, 56, 89]);
  });

  it("wipes out past the far end", () => {
    const engine = downEnd(0.8);
    engine.update({ tiltFwd: 0, stomp: false, stompStrength: 0, dt: 200 });
    expect(lit(engine)).toEqual([]);
  });

  it("scales its brightness with stomp strength", () => {
    const engine = new RecipeEngine(recipe(layer("trail", { palette: ["#ffffff"], length: 1, speed: 0 })), RING);
    engine.enter();
    step(engine, { stomp: true, stompStrength: 0 });
    // Flat, so each side's source is its middle: 91 - 27.5 rounds to 64.
    expect(pixel(engine, 64)).toEqual([0.3, 0.3, 0.3]);
  });
});

describe("flash", () => {
  // Like flow's flat-stomp flash, a frame draws the time left before that frame's own dt.
  it("starts at full on a flat stomp and fades out", () => {
    const engine = new RecipeEngine(recipe(layer("flash", { fadeMs: 100 })), RING);
    engine.enter();
    engine.update({ tiltFwd: 0, stomp: true, stompStrength: 1, dt: 50 });
    expect(pixel(engine, 3)).toEqual([1, 1, 1]);
    engine.update({ tiltFwd: 0, stomp: false, stompStrength: 0, dt: 16 });
    expect(pixel(engine, 3)).toEqual([0.5, 0.5, 0.5]);
    engine.update({ tiltFwd: 0, stomp: false, stompStrength: 0, dt: 34 });
    step(engine);
    expect(lit(engine)).toEqual([]);
  });
});

describe("sparkle", () => {
  it("spawns the expected number of sparkles, the same way every run", () => {
    const make = () => {
      const engine = new RecipeEngine(recipe(layer("sparkle", { density: 50, fadeMs: 10000 })), RING);
      engine.enter();
      for (let t = 0; t < 10; t++) step(engine, { dt: 20 });
      return lit(engine);
    };
    const first = make();
    expect(first.length).toBeGreaterThan(5);
    expect(first.length).toBeLessThanOrEqual(10);
    expect(make()).toEqual(first);
  });
});

describe("chase", () => {
  it("spaces comets evenly and moves them", () => {
    const engine = new RecipeEngine(recipe(layer("chase", { count: 2, length: 1, speed: 100 })), RING);
    engine.enter();
    engine.update({ tiltFwd: 0, stomp: false, stompStrength: 0, dt: 100 });
    expect(lit(engine)).toEqual([10, 65]);
  });

  // On RING each side is 55 steps, so 55 px/s crosses the foot in a second.
  function footChase(speed: number, dt: number): number[] {
    const engine = new RecipeEngine(recipe(layer("chase", { path: "foot", count: 1, length: 1, speed })), RING);
    engine.enter();
    advance(engine, dt);
    return lit(engine);
  }

  // Runs dt in steps the engine takes whole, since it caps one step at 250 ms.
  function advance(engine: RecipeEngine, dt: number): void {
    do {
      const slice = Math.min(dt, 250);
      engine.update({ tiltFwd: 0, stomp: false, stompStrength: 0, dt: slice });
      dt -= slice;
    } while (dt > 0);
  }

  it("runs heel to toe up both sides at once", () => {
    expect(footChase(55, 0)).toEqual([RING.heel]);
    // Halfway: 91 + 28 folds to 9 on one side, and 36 + 28 is 64 on the other.
    expect(footChase(55, 500)).toEqual([9, 64]);
  });

  it("runs toe to heel with a negative speed", () => {
    // A tenth of the way from the toe at 36: five steps down each side.
    expect(footChase(-55, 100)).toEqual([31, 41]);
  });

  it("lets the tail leave the toe before the comet starts again at the heel", () => {
    const engine = new RecipeEngine(recipe(layer("chase", { path: "foot", count: 1, length: 5, speed: 55 })), RING);
    engine.enter();
    // 57 px along: the head has gone past the toe, and the rest of the tail is leaving.
    advance(engine, 1000 * (57 / 55));
    expect(lit(engine)).toEqual([RING.toe - 2, RING.toe - 1, RING.toe, RING.toe + 1, RING.toe + 2]);
  });
});

describe("compositing", () => {
  it("skips disabled layers but keeps them running", () => {
    const fill = layer("fill", { palette: ["#ff0000"], scroll: 0 });
    const engine = new RecipeEngine(recipe(fill, { ...layer("flash", { trigger: "any" }), enabled: false }), RING);
    engine.enter();
    step(engine, { stomp: true, stompStrength: 1 });
    expect(pixel(engine, 0)).toEqual([1, 0, 0]);
  });

  it("adds, takes the max, and multiplies", () => {
    const red = layer("fill", { palette: ["#800000"], scroll: 0 });
    const blendWith = (blend: Layer["blend"]) => {
      const top = { ...layer("fill", { palette: ["#808080"], scroll: 0 }), blend };
      const engine = new RecipeEngine(recipe(red, top), RING);
      engine.enter();
      step(engine);
      return pixel(engine, 0);
    };
    const half = Math.round((128 / 255) * 1000) / 1000;
    expect(blendWith("add")).toEqual([1, half, half]);
    expect(blendWith("max")).toEqual([half, half, half]);
    expect(blendWith("multiply")[0]).toBeCloseTo(half * half, 2);
  });

  it("keeps running trails when a knob changes", () => {
    const trail = layer<TrailLayer>("trail", { length: 1, speed: 0 });
    const engine = new RecipeEngine(recipe(trail), RING);
    engine.enter();
    step(engine, { stomp: true, stompStrength: 1 });
    expect(lit(engine)).toEqual([9, 64]);
    engine.setRecipe(recipe({ ...trail, length: 3 }));
    step(engine);
    expect(lit(engine)).toContain(64);
  });
});
