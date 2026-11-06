import { firstPixelOver } from "./capMark";

describe("marking the slider past the soft cap", () => {
  it("starts at the first pixel standing for a level over the cap", () => {
    // 26 pixels running to 255: pixel 9 stands for about 93 and pixel 10 for about 103.
    expect(firstPixelOver(96, 255, 26)).toBe(10);
  });

  it("starts where the slider starts lighting pixels past the cap", () => {
    // The fill slider lights pixel i once the level reaches (i + 0.5) / 26 of the maximum.
    const litAt = (index: number) => ((index + 0.5) / 26) * 255;
    const first = firstPixelOver(96, 255, 26);
    expect(litAt(first - 1)).toBeLessThanOrEqual(96);
    expect(litAt(first)).toBeGreaterThan(96);
  });

  it("marks nothing when the slider can't go past the cap", () => {
    expect(firstPixelOver(96, 96, 26)).toBe(26);
    expect(firstPixelOver(96, 64, 26)).toBe(26);
    expect(firstPixelOver(96, 0, 26)).toBe(26);
  });

  it("marks every pixel when the cap sits under the first one", () => {
    expect(firstPixelOver(1, 255, 26)).toBe(0);
  });
});
