/**
 * Real screens in Storybook, run against pretend boots that speak the real protocol
 * (transport/fakeBoot.ts). Each story gets its own store from a loader, and the frame
 * disconnects its boots when the story closes, so one story's timers can't run into the next.
 */

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { BootsStore, type KeyValueStore } from "../../core/boots";
import { FakeBoot, FakeTransport, type FakeBootOptions } from "../../transport/fakeBoot";
import { AppNavigation, type MainTab } from "../components/AppNavigation";

const memoryStorage = (initial: Record<string, string>): KeyValueStore => {
  const data = new Map(Object.entries(initial));
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
  };
};

export interface FakeStoreOptions {
  left?: FakeBootOptions;
  right?: FakeBootOptions;
  /** Which boots are already labeled on this phone. */
  labeled?: ("left" | "right")[];
}

export interface FakeStore {
  store: BootsStore;
  left: FakeBoot;
  right: FakeBoot;
  /** A third boot nearby that isn't labeled, for the unlabeled detail screen. */
  stranger: FakeBoot;
}

const CURRENT = { brightness: 96, maxBrightness: 255, capBrightness: 96, capped: true, wander: true };

export async function fakeStore({ left = {}, right = {}, labeled = ["left", "right"] }: FakeStoreOptions = {}): Promise<FakeStore> {
  const leftBoot = new FakeBoot({ id: "3ED1", ...CURRENT, calibrated: true, neutralDeg: 1.56, ...left });
  const rightBoot = new FakeBoot({
    id: "7B20",
    ...CURRENT,
    leds: 110,
    toe: 40,
    heel: 90,
    poseAngles: { neutral: -0.8, heel: -22.5, toe: 41 },
    ...right,
  });
  const stranger = new FakeBoot({ id: "9C44", ...CURRENT });
  const boots = { left: leftBoot, right: rightBoot };
  const saved = labeled.map((side) => ({ side, deviceId: boots[side].deviceId, name: boots[side].name }));
  const store = new BootsStore(new FakeTransport([leftBoot, rightBoot, stranger]), memoryStorage({ boots: JSON.stringify(saved) }));
  await store.load();
  await settle(store);
  return { store, left: leftBoot, right: rightBoot, stranger };
}

/** Waits briefly for labeled boots to report in, so a story opens on a connected screen. */
async function settle(store: BootsStore): Promise<void> {
  const reachable = store.sides().filter((side) => store.client(side));
  for (let waited = 0; waited < 1500; waited += 50) {
    if (reachable.every((side) => store.client(side)?.getState().status)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The app's phone frame around a screen, re-rendering it whenever the store changes. */
export function PhoneFrame({ store, children, tab = "boots" }: { store: BootsStore; children: () => ReactNode; tab?: MainTab }) {
  useSyncExternalStore(store.subscribe, store.getVersion);
  useEffect(
    () => () => {
      for (const side of store.sides()) void store.client(side)?.disconnect();
    },
    [store],
  );
  return (
    <div className="app story-phone">
      <div className="simulated">Simulated boots, not real ones</div>
      <AppNavigation value={tab} onChange={() => undefined} />
      <section className="app-content" id={`main-panel-${tab}`} role="tabpanel" aria-labelledby={`main-tab-${tab}`}>{children()}</section>
    </div>
  );
}
