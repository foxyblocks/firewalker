import { describe, expect, it } from "vitest";

import { buildClipScript, posterFrame, sceneStarts, SCENES } from "./script";

describe("the clip script", () => {
  it("starts its scenes at the times audition pages jump to", () => {
    // Published audition pages hard-code these, so a change here breaks their scene buttons.
    expect(sceneStarts().map((scene) => scene.seconds)).toEqual([0, 3.008, 12.016, 21.024]);
    expect(buildClipScript()).toHaveLength(1627);
  });

  it("walks and plays music only in the scenes that say so", () => {
    const script = buildClipScript();
    for (const frame of script) expect(frame.walking).toBe(SCENES[frame.scene]!.walking);

    const level = (scene: number) => script.filter((frame) => frame.scene === scene).map((frame) => frame.audioLevel);
    expect(Math.max(...level(0))).toBe(0);
    expect(Math.max(...level(1))).toBe(0);
    expect(Math.max(...level(2))).toBeGreaterThan(0.7);
    expect(Math.min(...script.map((frame) => frame.audioLevel))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...script.map((frame) => frame.audioLevel))).toBeLessThanOrEqual(1);
  });

  it("takes the poster from the walking-with-music scene", () => {
    expect(buildClipScript()[posterFrame()]!.scene).toBe(2);
  });
});
