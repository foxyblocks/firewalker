import { describe, expect, it } from "vitest";

import { sideGeometry, topGeometry } from "./bootGeometry";
import { BOOT_3EB5, type StripLayout } from "../engine/strip";

// One ring each way round: toe first, and heel first like the real boots.
const TOE_FIRST: StripLayout = { count: 110, toe: 36, heel: 91 };

describe.each([
  ["toe first", TOE_FIRST],
  ["heel first", BOOT_3EB5],
])("top view, %s", (_, layout) => {
  const top = topGeometry(layout);

  it("places one point per pixel, with the controller over pixel 0", () => {
    expect(top.pixels).toHaveLength(layout.count);
    expect(top.controller).toEqual(top.pixels[0]);
  });

  it("puts the toe pixel at the top and the heel pixel at the bottom", () => {
    const ys = top.pixels.map((p) => p.y);
    expect(top.pixels[layout.toe]!.y).toBeCloseTo(Math.min(...ys), 0);
    expect(top.pixels[layout.heel]!.y).toBeCloseTo(Math.max(...ys), 0);
  });

  it("puts pixel 0 on the outer (right) side", () => {
    expect(top.pixels[0]!.x).toBeGreaterThan(150);
  });
});

describe("top view direction", () => {
  it("runs toward the toe first when the toe comes first, and toward the heel otherwise", () => {
    const toeFirst = topGeometry(TOE_FIRST).pixels;
    expect(toeFirst[5]!.y).toBeLessThan(toeFirst[0]!.y);
    const heelFirst = topGeometry(BOOT_3EB5).pixels;
    expect(heelFirst[5]!.y).toBeGreaterThan(heelFirst[0]!.y);
  });
});

describe("side view", () => {
  it("shows the outer side: the arc through pixel 0, heel on the left and toe on the right", () => {
    const side = sideGeometry(BOOT_3EB5);
    const indices = side.near.map((p) => p.index);
    expect(indices).toEqual(expect.arrayContaining([0, 100, BOOT_3EB5.toe, BOOT_3EB5.heel]));
    expect(indices).not.toContain(45);
    const toe = side.near.find((p) => p.index === BOOT_3EB5.toe)!;
    const heel = side.near.find((p) => p.index === BOOT_3EB5.heel)!;
    expect(toe.point.x).toBeGreaterThan(heel.point.x);
  });
});
