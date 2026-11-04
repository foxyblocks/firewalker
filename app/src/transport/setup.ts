/**
 * Picks real or pretend boots at startup, and the storage that goes with them.
 *
 * Pretend boots are used in two cases: Chrome with `?boot=fake`, and the iOS Simulator,
 * which has no Bluetooth. A real iPhone always has it, so "unsupported" on a native
 * build can only mean the Simulator, and the UI labels pretend boots so they can't be
 * mistaken for the real thing.
 *
 * For UI work, the URL can set up a scenario:
 *   ?boot=fake&paired=1            skip Find boots with both boots already labeled
 *   &patterns=6                    how many patterns the boots have
 *   &mismatch=1                    Right lacks the last pattern
 *   &firmware=current              firmware without the newer commands
 *   &sensor=missing                Right's motion sensor is unavailable
 *   &save=fail                     Left's flash writes fail
 *   &offline=1                     Right is out of range
 */

import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import type { KeyValueStore } from "../core/boots";
import { DEFAULT_PATTERNS } from "../core/protocol";
import { BleTransport } from "./ble";
import { FakeBoot, FakeTransport } from "./fakeBoot";
import type { Transport } from "./transport";

const preferencesStorage: KeyValueStore = {
  async get(key) {
    return (await Preferences.get({ key })).value;
  },
  async set(key, value) {
    await Preferences.set({ key, value });
  },
};

function memoryStorage(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
  };
}

function fakeSetup(params: URLSearchParams): { transport: Transport; storage: KeyValueStore } {
  const firmware = params.get("firmware") === "current" ? "current" : "planned";
  const count = Number(params.get("patterns") ?? DEFAULT_PATTERNS.length);
  const patterns = [
    ...DEFAULT_PATTERNS,
    ...Array.from({ length: Math.max(0, count - DEFAULT_PATTERNS.length) }, (_, index) => `pattern-${index + 3}`),
  ];
  const left = new FakeBoot({
    id: "3ED1",
    firmware,
    patterns,
    wander: true,
    calibrated: true,
    neutralDeg: 1.56,
    saveFails: params.get("save") === "fail",
  });
  const right = new FakeBoot({
    id: "7B20",
    firmware,
    patterns: params.get("mismatch") ? patterns.slice(0, -1) : patterns,
    wander: true,
    sensor: params.get("sensor") === "missing" ? "unavailable" : "ok",
    poseAngles: { neutral: -0.8, heel: -22.5, toe: 41 },
  });
  if (params.get("offline")) right.reachable = false;

  const saved: Record<string, string> = {};
  if (params.get("paired")) {
    saved.boots = JSON.stringify([
      { side: "left", deviceId: left.deviceId, name: left.name },
      { side: "right", deviceId: right.deviceId, name: right.name },
    ]);
  }
  return { transport: new FakeTransport([left, right]), storage: memoryStorage(saved) };
}

export async function setUpBoots(): Promise<{ transport: Transport; storage: KeyValueStore }> {
  const params = new URLSearchParams(window.location.search);
  if (params.get("boot") === "fake") return fakeSetup(params);

  const transport = new BleTransport();
  if (Capacitor.isNativePlatform() && (await transport.radioState()) === "unsupported") {
    return fakeSetup(params);
  }
  return { transport, storage: preferencesStorage };
}
