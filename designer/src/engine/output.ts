// What a boot does to a frame between the engine and the LEDs, so the simulator can show it.
//
// The engine draws in smooth 0..1 colors. A boot turns each channel into a whole number from 0
// to 255, then scales that by its brightness setting and drops the fraction. At the default
// brightness of 67 that leaves 68 steps per channel, and at 16 only 17, so a fade moves in
// visible jumps, a dim channel can land on 0, and a dim color can change hue. For example,
// #7a00ff at 12% stored as (15, 0, 31) reaches the strip at 16 as (0, 0, 2): a dim purple
// comes out blue.
//
// Simulation runs this after the engine, on the way to the canvases. The engine itself never
// sees brightness, the same as on the firmware, where patterns leave it to the caller.

// The firmware's LED_BRIGHTNESS (a new boot's setting), LED_BRIGHTNESS_MIN, and
// LED_BRIGHTNESS_MAX (the highest a remote can set), from include/config.h. A test fails if
// they drift apart.
export const BOOT_BRIGHTNESS = { default: 67, min: 1, max: 96 } as const;

// A brightness as the percent the phone app shows: a share of the highest a remote can set.
export function brightnessPercent(brightness: number): number {
  return Math.round((brightness / BOOT_BRIGHTNESS.max) * 100);
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
