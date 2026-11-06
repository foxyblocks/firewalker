// What a boot does to a frame between the engine and the LEDs, so the simulator can show it.
//
// The engine draws in smooth 0..1 colors. A boot turns each channel into a whole number from 0
// to 255, then scales that by its brightness setting and drops the fraction. At the default
// brightness of 96 that leaves 97 steps per channel, and at 16 only 17, so a fade moves in
// visible jumps, a dim channel can land on 0, and a dim color can change hue. For example,
// #7a00ff at 12% stored as (15, 0, 31) reaches the strip at 16 as (0, 0, 2): a dim purple
// comes out blue.
//
// Simulation runs this after the engine, on the way to the canvases. The engine itself never
// sees brightness, the same as on the firmware, where patterns leave it to the caller.

// The firmware's brightness limits, from include/config.h. A new boot starts at its soft cap
// (LED_BRIGHTNESS_SOFT_CAP), the highest it accepts while the cap is on, and a remote can turn
// the cap off to reach LED_BRIGHTNESS_MAX. A test fails if they drift apart.
export const BOOT_BRIGHTNESS = { default: 96, min: 1, cap: 96, max: 255 } as const;

// A brightness as the percent the phone app shows, which is a share of what the boot accepts
// right now. A level at or under the soft cap reads as a share of the cap, as the app shows it
// with the cap on, so 48 is 50%. A level over the cap needs the cap off, where the app shows a
// share of 255, so 128 is 50% too. `overCap` tells those apart.
export function brightnessPercent(brightness: number): number {
  const ceiling = overCap(brightness) ? BOOT_BRIGHTNESS.max : BOOT_BRIGHTNESS.cap;
  return Math.round((brightness / ceiling) * 100);
}

// Whether a brightness is only reachable with the soft cap off.
export function overCap(brightness: number): boolean {
  return brightness > BOOT_BRIGHTNESS.cap;
}

// A 0..1 color channel as the 0..255 value a boot stores.
export function toChannelByte(value: number): number {
  return Math.floor(Math.min(1, Math.max(0, value)) * 255 + 0.5);
}

// A port of scaleChannel in src/firewalker_strip.cpp, which runs when a boot sends a frame.
export function scaleChannel(value: number, brightness: number): number {
  return brightness === 255 ? value : (value * (brightness + 1)) >> 8;
}

// How many different levels a channel can reach at this brightness, counting off.
export function channelSteps(brightness: number): number {
  return scaleChannel(255, brightness) + 1;
}

// Writes `frame` to `out` as it reaches the strip at this brightness, stretched back to 0..1.
// A screen can't show how dim a boot really is, and your eye adapts to a boot's real level
// anyway, so full white stays full white here and only the lost steps and colors show.
export function applyBootBrightness(frame: Float32Array, brightness: number, out: Float32Array): void {
  const full = scaleChannel(255, brightness);
  for (let i = 0; i < frame.length; i++) {
    out[i] = scaleChannel(toChannelByte(frame[i]!), brightness) / full;
  }
}
