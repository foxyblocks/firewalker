import { describe, expect, it } from "vitest";

import { dropHeight, FRAME_MS, gaitLift, Simulation } from "./simulation";
import { BOOT_3EB5 } from "../engine/strip";
import { newLayer } from "../recipe/spec";
import type { Recipe } from "../recipe/types";

// The frame loop needs a browser, so these step the simulation directly.
interface Internals {
  step(): void;
  stomps: number;
  lift: number;
  tilt: number;
}

function simulation(): { sim: Simulation; inside: Internals } {
  const recipe: Recipe = { format: "firewalker-recipe", version: 1, name: "t", description: "", layers: [newLayer("fill")] };
  const sim = new Simulation(recipe, BOOT_3EB5);
  return { sim, inside: sim as unknown as Internals };
}

function run(inside: Internals, ms: number): void {
  for (let t = 0; t < ms; t += FRAME_MS) inside.step();
}

describe("an animated stomp", () => {
  it("lifts the boot first and lands the stomp when it comes down", () => {
    const { sim, inside } = simulation();
    sim.stomp(1);
    run(inside, 96);
    expect(inside.stomps).toBe(0);
    expect(inside.lift).toBeGreaterThan(50);
    run(inside, 144);
    expect(inside.stomps).toBe(1);
    expect(inside.lift).toBe(0);
  });

  it("lands at once while paused, so its first frame shows", () => {
    const { sim, inside } = simulation();
    sim.setPaused(true);
    sim.stomp(0.5);
    inside.step();
    expect(inside.stomps).toBe(1);
  });

  it("rises fast and falls like it's under gravity", () => {
    const drop = { riseMs: 100, fallMs: 100, strength: 1 };
    expect(dropHeight({ ...drop, elapsedMs: 0 })).toBe(0);
    expect(dropHeight({ ...drop, elapsedMs: 50 })).toBe(0.75);
    expect(dropHeight({ ...drop, elapsedMs: 100 })).toBe(1);
    expect(dropHeight({ ...drop, elapsedMs: 150 })).toBe(0.75);
    expect(dropHeight({ ...drop, elapsedMs: 200 })).toBe(0);
  });
});

describe("the beat", () => {
  it("stomps once per beat", () => {
    const { sim, inside } = simulation();
    sim.setBeat(120, 0.7);
    run(inside, 5000);
    // The first lands about 220 ms in, then one every 500 ms.
    expect(inside.stomps).toBe(10);
  });

  it("keeps up at the fastest tempo", () => {
    const { sim, inside } = simulation();
    sim.setBeat(240, 0.7);
    run(inside, 5000);
    expect(inside.stomps).toBeGreaterThanOrEqual(19);
  });

  it("stops when it's turned off, after a boot already in the air comes down", () => {
    const { sim, inside } = simulation();
    sim.setBeat(120, 0.7);
    run(inside, 1000);
    const before = inside.stomps;
    sim.setBeat(null, 0.7);
    run(inside, 2000);
    expect(inside.stomps - before).toBeLessThanOrEqual(1);
    const after = inside.stomps;
    run(inside, 2000);
    expect(inside.stomps).toBe(after);
  });
});

describe("walking", () => {
  it("goes back to the slider's tilt when it stops", () => {
    const { sim, inside } = simulation();
    sim.setTilt(0.5);
    sim.setWalking(true);
    run(inside, 400);
    sim.setTilt(-0.25);
    sim.setWalking(false);
    expect(inside.tilt).toBe(-0.25);
  });

  it("keeps the foot down through the stance and lifts it in the swing", () => {
    expect(gaitLift(0.3)).toBe(0);
    expect(gaitLift(0.86)).toBeCloseTo(1);
    expect(gaitLift(1)).toBeCloseTo(0);
  });
});
