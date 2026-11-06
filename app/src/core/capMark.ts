/**
 * Where the brightness slider marks the levels past the soft cap, while a boot's cap is off.
 * The slider (PixelSlider in ui/parts.tsx) draws far fewer pixels than levels, and a fill
 * pixel stands for the level at its middle, so the outline around the levels past the cap
 * starts before the first pixel that stands for a level over it. That puts its left edge in
 * the gap between two pixels, where the slider's lit pixels cross the cap, rather than through
 * a pixel.
 */

/**
 * The first pixel standing for a level over `cap`, or `pixels` when none does. With 26
 * pixels running to 255 and a cap of 96, pixel 9 stands for about 93 and pixel 10 for about
 * 103, so it returns 10, about 38% across.
 */
export function firstPixelOver(cap: number, max: number, pixels: number): number {
  if (max <= cap) return pixels;
  for (let index = 0; index < pixels; index++) {
    if (((index + 0.5) / pixels) * max > cap) return index;
  }
  return pixels;
}
