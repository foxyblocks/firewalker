import { describe, expect, it } from "vitest";

import { gaitForwardAccel } from "./simulation";
import { newSloshState, SLOSH, sloshStep } from "./slosh";

const FRAME = 0.016;
const GRAVITY = 9.80665;

// Runs the water for `seconds` under a constant pull and returns every value it took.
function run(state: ReturnType<typeof newSloshState>, pushG: number, pourG: number, seconds: number): number[] {
  const values: number[] = [];
  for (let t = 0; t < seconds; t += FRAME) values.push(sloshStep(state, pushG, pourG, FRAME));
  return values;
}

describe("slosh", () => {
  it("stays level when nothing pulls on it", () => {
    expect(run(newSloshState(), 0, 0, 2).every((value) => value === 0)).toBe(true);
  });

  it("is thrown to the heel while the boot speeds up, and levels out at a steady speed", () => {
    const state = newSloshState();
    const speedingUp = run(state, -0.5, 0, 0.3);
    expect(Math.min(...speedingUp)).toBeLessThan(-0.3);
    const steady = run(state, 0, 0, 3);
    expect(Math.abs(steady.at(-1)!)).toBeLessThan(0.02);
  });

  it("is thrown to the toe when the boot stops, then rocks back past level before it settles", () => {
    const state = newSloshState();
    const stopping = run(state, 1, 0, 0.15);
    const after = run(state, 0, 0, 3);
    expect(Math.max(...stopping, ...after)).toBeGreaterThan(0.5);
    // Water overshoots: after the surge to the toe it swings back toward the heel.
    expect(Math.min(...after)).toBeLessThan(-0.05);
    expect(Math.abs(after.at(-1)!)).toBeLessThan(0.02);
  });

  it("pours toward the toe when the toe is down, more gently than a push of the same size", () => {
    const poured = run(newSloshState(), 0, 0.5, 4).at(-1)!;
    const pushed = run(newSloshState(), 0.5, 0, 4).at(-1)!;
    expect(poured).toBeGreaterThan(0.1);
    expect(poured).toBeLessThan(pushed);
  });

  it("never leaves -1..1, even through a spike far past the ceiling", () => {
    const state = newSloshState();
    const values = [...run(state, 40, 0, 1), ...run(state, -40, 0, 1), ...run(state, Number.NaN, 0, 0.1)];
    expect(values.every((value) => Number.isFinite(value) && Math.abs(value) <= 1)).toBe(true);
    expect(Math.abs(state.position)).toBeLessThanOrEqual(SLOSH.maxPull);
  });

  it("treats a stalled frame as a short step, so a hitch can't fling the water", () => {
    const stalled = newSloshState();
    const normal = newSloshState();
    sloshStep(stalled, 1, 0, 5);
    sloshStep(normal, 1, 0, SLOSH.maxStepSeconds);
    expect(stalled).toEqual(normal);
  });
});

describe("the walking gait's pushes", () => {
  it("leaves the foot still on the ground, speeds it up into the swing, and slows it to a stop", () => {
    expect(gaitForwardAccel(0.3)).toBe(0);
    expect(gaitForwardAccel(0.75)).toBeGreaterThan(GRAVITY);
    expect(gaitForwardAccel(0.97)).toBeLessThan(-GRAVITY);
  });

  it("brings the foot back to rest by the heel strike", () => {
    // Speeding up and slowing down cancel over one swing, so the foot lands standing still.
    let speed = 0;
    const steps = 1000;
    for (let i = 0; i < steps; i++) speed += gaitForwardAccel(0.72 + (0.28 * (i + 0.5)) / steps) * ((0.28 * 1.4) / steps);
    expect(Math.abs(speed)).toBeLessThan(0.01);
  });
});
