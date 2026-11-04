/**
 * The rules behind the three sliders on the Calibrate sheet's Strip tab: how far each one
 * reaches, and where a drag or a nudge lands. The boot has the final say on all of this
 * (applyStripSetting in include/firewalker_strip_map.h), so these just keep the sliders from
 * asking for something it would refuse.
 *
 * Pixels are numbered from 0, the first one after the controller, the same as the firmware
 * and docs/remote-protocol.md. So on a 110-pixel ring, the last pixel is 109.
 */

import type { BootState } from "./boot";
import { PROTOCOL_VERSION, type StripSetting } from "./protocol";

// Toe and heel each need a pixel of their own.
const MIN_LEDS = 2;

export interface StripValues {
  leds: number;
  maxLeds: number;
  toe: number;
  heel: number;
}

/**
 * The layout to show for a boot: a change on its way, or what it last reported. Nothing for
 * a boot that hasn't reported yet, or whose firmware is too old to have a layout.
 */
export function shownStrip(state: BootState): StripValues | undefined {
  const { status, pending } = state;
  if (!status || (status.proto ?? 0) < PROTOCOL_VERSION) return undefined;
  return {
    leds: pending.leds ?? status.leds,
    maxLeds: status.maxLeds,
    toe: pending.toe ?? status.toe,
    heel: pending.heel ?? status.heel,
  };
}

export function sliderRange(setting: StripSetting, values: StripValues): { min: number; max: number } {
  return setting === "leds" ? { min: MIN_LEDS, max: values.maxLeds } : { min: 0, max: values.leds - 1 };
}

/** The pixel this slider's marker can't land on, which is the other marker's. */
function occupied(setting: StripSetting, values: StripValues): number | undefined {
  if (setting === "toe") return values.heel;
  if (setting === "heel") return values.toe;
  return undefined;
}

/**
 * Where a drag lands when the finger is over `wanted`. Over the other marker's pixel it
 * stays where it was, so the marker seems to hop that pixel as the finger crosses it.
 * Toe and heel can otherwise pass each other, since a strip can run either way around.
 */
export function dragTo(setting: StripSetting, wanted: number, values: StripValues): number {
  const { min, max } = sliderRange(setting, values);
  const clamped = Math.max(min, Math.min(max, wanted));
  return clamped === occupied(setting, values) ? values[setting] : clamped;
}

/**
 * Where a one-pixel step lands, which is how you settle on the exact pixel: a slider on a
 * phone is only about two points per pixel. It steps over the other marker, and stays put
 * rather than leave the strip.
 */
export function nudge(setting: StripSetting, step: 1 | -1, values: StripValues): number {
  const { min, max } = sliderRange(setting, values);
  let next = values[setting] + step;
  if (next === occupied(setting, values)) next += step;
  return next < min || next > max ? values[setting] : next;
}
