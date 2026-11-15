import { describe, expect, it } from "vitest";

import type { Knob, Recipe } from "../../src/recipe/types";
import { buildClipScript, clipScenes, posterFrame, sceneStarts, SCENES, SLIDE_SCENE } from "./script";

// The smallest recipes that do and don't follow slosh.
function fill(offset: Knob): Recipe {
  return {
    format: "firewalker-recipe",
    version: 3,
    name: "test",
    description: "",
    layers: [
      { type: "fill", enabled: true, palette: ["#ff0000"], spread: "foot", repeat: 1, offset, scroll: 0, brightness: 1, blend: "over", opacity: 1 },
    ],
  };
}

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

  it("never pushes the boot in the shared scenes", () => {
    expect(buildClipScript().some((frame) => frame.pushing)).toBe(false);
    expect(clipScenes(fill(0.2))).toBe(SCENES);
  });

  it("adds a push-and-stop scene on the end for a pattern that follows slosh", () => {
    const scenes = clipScenes(fill({ source: "slosh", min: 0, max: 1 }));
    expect(scenes).toEqual([...SCENES, SLIDE_SCENE]);

    // The shared scenes play exactly as they do for every other pattern.
    const script = buildClipScript(scenes);
    const shared = buildClipScript();
    expect(script.slice(0, shared.length)).toEqual(shared);
    expect(sceneStarts(scenes).map((scene) => scene.seconds)).toEqual([0, 3.008, 12.016, 21.024, 26.032]);

    // Two pushes, each let go with time left to watch the water settle.
    const slide = script.slice(shared.length);
    expect(slide.every((frame) => frame.scene === 4 && !frame.walking)).toBe(true);
    // The music from the scene before has faded out by the time the first push starts.
    expect(slide.filter((frame) => frame.pushing).every((frame) => frame.audioLevel < 0.01)).toBe(true);
    const starts = slide.filter((frame, i) => frame.pushing && !slide[i - 1]?.pushing).length;
    expect(starts).toBe(2);
    expect(slide.at(-1)!.pushing).toBe(false);
  });

  it("leaves the slide out when the only slosh layer is disabled", () => {
    const recipe = fill({ source: "sloshAmount", min: 0, max: 1 });
    recipe.layers[0]!.enabled = false;
    expect(clipScenes(recipe)).toBe(SCENES);
  });
});
