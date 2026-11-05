// Exercise fixed audio/tilt/stomp bindings on rings that run in either direction.
// The kept Bass Ripple recipe stays editable without changing this geometry contract.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { RecipeEngine, type EngineInput } from "./engine";
import { BENCH_STRIP, BOOT_3EB5, BOOT_3ED8, foreAft, type StripLayout } from "./strip";
import { validateRecipe } from "../recipe/validate";

const parsed = validateRecipe(JSON.parse(readFileSync(new URL("../../../test/fixtures/recipe-frames/recipes/band.json", import.meta.url), "utf8")));
if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
const BASS_RIPPLE = parsed.recipe;
const LAYOUTS = [BENCH_STRIP, BOOT_3EB5, BOOT_3ED8];

function step(engine: RecipeEngine, input: Partial<EngineInput> = {}) {
  engine.update({ tiltFwd: 0, stomp: false, stompStrength: 0, audioLevel: 0.5, dt: 16, ...input });
}

function lit(engine: RecipeEngine): number[] {
  return Array.from({ length: engine.pixelCount }, (_, i) => i).filter((i) =>
    engine.frame.slice(i * 3, i * 3 + 3).some((channel) => channel > 0.001),
  );
}

function peak(engine: RecipeEngine): number {
  return Math.max(...engine.frame);
}

function center(engine: RecipeEngine, layout: StripLayout): number {
  const pixels = lit(engine);
  return pixels.reduce((total, i) => total + foreAft(i, layout), 0) / pixels.length;
}

describe("Bass Ripple", () => {
  it.each([...LAYOUTS, { count: 2, toe: 0, heel: 1 }])("is dark at zero volume and fills the ring at full volume on $count pixels", (layout) => {
    const engine = new RecipeEngine(BASS_RIPPLE, layout);
    for (const tiltFwd of [-1, 0, 1]) {
      step(engine, { audioLevel: 0, tiltFwd, stomp: true });
      expect(lit(engine)).toEqual([]);
      step(engine, { audioLevel: 1, tiltFwd });
      expect(lit(engine)).toHaveLength(layout.count);
      // A full-width mask covers the toe and heel completely too.
      for (let i = 0; i < layout.count; i++) {
        expect(Math.max(...engine.frame.slice(i * 3, i * 3 + 3))).toBeCloseTo(peak(engine));
      }
    }
  });

  it.each(LAYOUTS)("centers a half-volume bar and slides it downhill without losing width on $count pixels", (layout) => {
    const engine = new RecipeEngine(BASS_RIPPLE, layout);
    step(engine);
    const flatPixels = lit(engine).length;
    expect(Math.abs(flatPixels - layout.count / 2)).toBeLessThanOrEqual(2);
    expect(center(engine, layout)).toBeCloseTo(0.5, 2);
    expect(engine.frame[layout.toe * 3]).toBe(0);
    expect(engine.frame[layout.heel * 3]).toBe(0);

    step(engine, { tiltFwd: 1 });
    expect(Math.abs(lit(engine).length - flatPixels)).toBeLessThanOrEqual(2);
    expect(Math.abs(center(engine, layout) - 0.75)).toBeLessThan(0.02);
    expect(engine.frame[layout.toe * 3]).toBeGreaterThan(0);
    expect(engine.frame[layout.heel * 3]).toBe(0);

    step(engine, { tiltFwd: -1 });
    expect(Math.abs(lit(engine).length - flatPixels)).toBeLessThanOrEqual(2);
    expect(Math.abs(center(engine, layout) - 0.25)).toBeLessThan(0.02);
    expect(engine.frame[layout.heel * 3]).toBeGreaterThan(0);
    expect(engine.frame[layout.toe * 3]).toBe(0);
  });

  it("flashes the current bar from 70% to 100%, then fades back over 200 ms", () => {
    const engine = new RecipeEngine(BASS_RIPPLE, BOOT_3EB5);
    step(engine);
    const before = lit(engine);
    expect(peak(engine)).toBeCloseTo(0.7);
    step(engine, { stomp: true });
    expect(peak(engine)).toBeCloseTo(1);
    expect(lit(engine)).toEqual(before);
    step(engine, { dt: 100 });
    expect(peak(engine)).toBeCloseTo(0.85);
    step(engine, { dt: 100 });
    expect(peak(engine)).toBeCloseTo(0.7);
  });
});
