/**
 * Picks real or pretend boots at startup, and the storage that goes with them. Real boots are
 * Bluetooth on an iPhone. A desktop browser with Web Serial offers USB too.
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
 *   &proto=0                       firmware too old for this app
 *   &sensor=missing                Right's motion sensor is unavailable
 *   &save=fail                     Left's flash writes fail
 *   &offline=1                     Right is out of range
 *   &access=lost                   the browser lost access to both, as a reload can do
 *   &capture=moving                Left moves during every capture
 *   &capture=conflict              Right has old poses that block replacement after remounting
 *   &usb=1                         offer Add over USB beside Bluetooth, as a desktop browser does
 *   &usb=busy                      the same, but another program has the boot's USB port
 *   &cap=off                       Left's soft brightness cap is off
 *   &cap=none                      firmware from before the soft cap, with a fixed maximum
 */

import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import type { KeyValueStore } from "../core/boots";
import { BleTransport } from "./ble";
import { BrowserTransport } from "./browser";
import { FakeBoot, FakeTransport } from "./fakeBoot";
import type { Transport } from "./transport";
import { usbSupported, UsbTransport } from "./usb";

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
  const proto = params.get("proto") === null ? undefined : Number(params.get("proto"));
  const extraPatterns = Math.max(0, Number(params.get("patterns") ?? 2) - 2);
  const patterns = ["rainbow-pool", "fire-stomp", ...Array.from({ length: extraPatterns }, (_, index) => `pattern-${index + 3}`)];
  // Current firmware: a new boot starts at its soft cap of 96, with the cap on.
  const brightness =
    params.get("cap") === "none" ? {} : { brightness: 96, maxBrightness: 255, capBrightness: 96 };
  const left = new FakeBoot({
    id: "3ED1",
    proto,
    ...brightness,
    capped: params.get("cap") !== "off",
    patterns,
    wander: true,
    calibrated: true,
    neutralDeg: 1.56,
    saveFails: params.get("save") === "fail",
  });
  const right = new FakeBoot({
    id: "7B20",
    proto,
    ...brightness,
    leds: 110,
    toe: 40,
    heel: 90,
    patterns: params.get("mismatch") ? patterns.slice(0, -1) : patterns,
    wander: true,
    sensor: params.get("sensor") === "missing" ? "unavailable" : "ok",
    ...(params.get("capture") === "conflict" ? {
      calibrated: true, neutralDeg: -40.6, heelDeg: -80, toeDeg: 84.1,
      poseAngles: { neutral: -40.6, heel: -15.6, toe: -65.6 },
    } : { poseAngles: { neutral: -0.8, heel: -22.5, toe: 41 } }),
  });
  if (params.get("offline")) right.reachable = false;
  if (params.get("access") === "lost") left.accessLost = right.accessLost = true;
  left.moving = params.get("capture") === "moving";

  const saved: Record<string, string> = {};
  if (params.get("paired")) {
    saved.boots = JSON.stringify([
      { side: "left", deviceId: left.deviceId, name: left.name },
      { side: "right", deviceId: right.deviceId, name: right.name },
    ]);
  }
  const usb = params.get("usb");
  const transport = usb
    ? new FakeTransport([left, right], "picker", ["bluetooth", "usb"])
    : new FakeTransport([left, right]);
  transport.usbPortBusy = usb === "busy";
  return { transport, storage: memoryStorage(saved) };
}

export async function setUpBoots(): Promise<{ transport: Transport; storage: KeyValueStore }> {
  const params = new URLSearchParams(window.location.search);
  if (params.get("boot") === "fake") return fakeSetup(params);

  const bluetooth = new BleTransport();
  if (Capacitor.isNativePlatform()) {
    if ((await bluetooth.radioState()) === "unsupported") return fakeSetup(params);
    return { transport: bluetooth, storage: preferencesStorage };
  }
  const transport = usbSupported() ? new BrowserTransport(bluetooth, new UsbTransport()) : bluetooth;
  return { transport, storage: preferencesStorage };
}
