import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { applyBootBrightness, BOOT_BRIGHTNESS, channelSteps, scaleChannel, toChannelByte } from "./output";

function shown(colors: number[], brightness: number): number[] {
  const out = new Float32Array(colors.length);
  applyBootBrightness(Float32Array.from(colors), brightness, out);
  return Array.from(out);
}

describe("boot brightness", () => {
  it("scales a channel the way the firmware does", () => {
    expect(scaleChannel(255, 16)).toBe(16);
    expect(scaleChannel(16, 16)).toBe(1);
    expect(scaleChannel(15, 16)).toBe(0);
    expect(scaleChannel(255, 64)).toBe(64);
    expect(scaleChannel(128, 255)).toBe(128);
  });

  it("counts the steps a channel has left", () => {
    expect(channelSteps(16)).toBe(17);
    expect(channelSteps(32)).toBe(33);
    expect(channelSteps(64)).toBe(65);
  });

  it("rounds and limits a color to a whole channel value", () => {
    expect(toChannelByte(0)).toBe(0);
    expect(toChannelByte(1)).toBe(255);
    expect(toChannelByte(0.5)).toBe(128);
    expect(toChannelByte(-1)).toBe(0);
    expect(toChannelByte(2)).toBe(255);
  });

  it("keeps full white at full on the screen, at any brightness", () => {
    for (const brightness of [1, 16, 64]) expect(shown([1, 1, 1], brightness)).toEqual([1, 1, 1]);
  });

  it("turns a dim purple blue at the default brightness, and keeps it purple higher up", () => {
    const purple = [(0x7a / 255) * 0.12, 0, 0.12];
    expect(shown(purple, 16)).toEqual([0, 0, 2 / 16]);
    const [red, , blue] = shown(purple, 64);
    expect(red).toBeGreaterThan(0);
    expect(blue).toBeGreaterThan(red!);
  });

  it("loses a dim color entirely at the lowest brightness", () => {
    expect(shown([0.2, 0.2, 0.2], 1)).toEqual([0, 0, 0]);
  });

  it("matches the firmware's settings", () => {
    const config = readFileSync(new URL("../../../include/config.h", import.meta.url), "utf8");
    const value = (pattern: RegExp) => Number(pattern.exec(config)?.[1]);
    expect(BOOT_BRIGHTNESS.default).toBe(value(/#define FIREWALKER_LED_BRIGHTNESS (\d+)/));
    expect(BOOT_BRIGHTNESS.max).toBe(value(/#define FIREWALKER_LED_BRIGHTNESS_MAX (\d+)/));
    expect(BOOT_BRIGHTNESS.min).toBe(value(/LED_BRIGHTNESS_MIN = (\d+)/));
  });
});
