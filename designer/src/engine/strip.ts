// The strip's layout and the per-pixel geometry the engine needs, ported from
// include/firewalker_strip_map.h. The strip is a closed ring around the foot: pixel 0 sits
// under the controller, and the indices run around the foot and back to the start. Each boot
// saves where its toe apex and heel are, so the ring can run either way: toe before heel, or
// heel before toe.
//
// Two arcs join toe and heel, each named by the direction its indices climb: "toe to heel"
// (toe, toe+1, ... heel) and "heel to toe" (heel, heel+1, ... toe). Whichever one crosses the
// end of the strip wraps from the last pixel to pixel 0. Movement along an arc uses unwrapped
// positions, such as heel..heel+heelToToe, folded back to real pixels only when painting.

export interface StripLayout {
  count: number;
  toe: number;
  heel: number;
}

// The uncut bench strip, matching STRIP_DEFAULT_LAYOUT in include/config.h.
export const BENCH_STRIP: StripLayout = { count: 160, toe: 52, heel: 132 };
// Each boot's saved layout, as set from the app's Strip tab, so the simulator's strip menu matches the real
// boot. Each ring runs heel first. Read from the boots: 3EB5 on 2026-11-05, and 3ED8 on 2026-11-04.
export const BOOT_3EB5: StripLayout = { count: 107, toe: 72, heel: 18 };
export const BOOT_3ED8: StripLayout = { count: 94, toe: 86, heel: 48 };
// What the pattern list's thumbnails show.
export const DEFAULT_STRIP = BOOT_3EB5;

export const STRIP_PRESETS: { key: string; label: string; layout: StripLayout }[] = [
  { key: "3eb5", label: `Boot 3EB5, ${BOOT_3EB5.count} px`, layout: BOOT_3EB5 },
  { key: "3ed8", label: `Boot 3ED8, ${BOOT_3ED8.count} px`, layout: BOOT_3ED8 },
  { key: "bench", label: `Uncut bench strip, ${BENCH_STRIP.count} px`, layout: BENCH_STRIP },
];

// The firmware's STRIP_MIN_PIXELS. The most it drives is FIREWALKER_LED_COUNT, 160 today.
const MIN_PIXELS = 2;
const MAX_PIXELS = 300;

export function layoutProblem(layout: StripLayout): string | null {
  const { count, toe, heel } = layout;
  if (![count, toe, heel].every(Number.isInteger)) return "Pixel counts must be whole numbers.";
  if (count < MIN_PIXELS || count > MAX_PIXELS) return `The strip needs ${MIN_PIXELS} to ${MAX_PIXELS} pixels.`;
  if (toe < 0 || toe >= count || heel < 0 || heel >= count) return "Toe and heel must be pixels on the strip.";
  if (toe === heel) return "Toe and heel need a pixel each.";
  return null;
}

// Steps along the arc whose indices climb from the toe to the heel.
export function toeToHeelLength(layout: StripLayout): number {
  return (layout.heel + layout.count - layout.toe) % layout.count;
}

// Steps along the arc whose indices climb from the heel to the toe.
export function heelToToeLength(layout: StripLayout): number {
  return layout.count - toeToHeelLength(layout);
}

export function wrapIndex(p: number, count: number): number {
  return ((p % count) + count) % count;
}

// Fore-aft foot position of pixel i: heel 0, toe 1, linear along whichever arc it's on.
export function foreAft(i: number, layout: StripLayout): number {
  const { count, toe, heel } = layout;
  const toeToHeel = toeToHeelLength(layout);
  const stepsFromToe = (i + count - toe) % count;
  if (stepsFromToe <= toeToHeel) return (toeToHeel - stepsFromToe) / toeToHeel;
  return ((i + count - heel) % count) / heelToToeLength(layout);
}

// Whether pixel i is on the arc that runs through pixel 0. The controller, and so pixel 0,
// clips to the boot's outer side, so this is the outer side's arc.
export function onOuterArc(i: number, layout: StripLayout): boolean {
  const { count, toe, heel } = layout;
  const stepsFromToe = (i + count - toe) % count;
  const onToeToHeel = stepsFromToe <= toeToHeelLength(layout);
  const outerIsToeToHeel = toe > heel;
  // Toe and heel sit on both arcs.
  if (i === toe || i === heel) return true;
  return onToeToHeel === outerIsToeToHeel;
}
