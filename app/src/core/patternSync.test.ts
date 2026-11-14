// Pattern sync end to end, against pretend boots that speak the real protocol (transport/fakeBoot.ts)
// with the designer's recipe slots, which decode every upload the way the firmware does. The
// catalog is built from the repo's real patterns/ folder.

import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildCatalog, catalogJson } from "../../../designer/server/catalog";
import { FakeBoot as RecipeBoot } from "../../../designer/src/boot/fakeBoot";
import { compileRecipe } from "../../../designer/src/recipe/compile";
import type { Recipe } from "../../../designer/src/recipe/types";
import type { CatalogJson } from "../../../shared/patternCatalog";
import { compiledCrc } from "../../../shared/recipeBinary";
import { FakeBoot, FakeTransport } from "../transport/fakeBoot";
import { attachRecipes } from "../transport/fakeRecipes";
import { BootsStore, type KeyValueStore } from "./boots";
import { PatternLibrary } from "./patternLibrary";
import { onBootKey, PatternSync } from "./patternSync";

const PATTERNS_DIR = fileURLToPath(new URL("../../../patterns", import.meta.url));
const realCatalog = (): Promise<CatalogJson> => buildCatalog(PATTERNS_DIR, "abc123");

function memoryStorage(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
  };
}

async function waitFor(condition: () => boolean, what = "the condition", timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface Rig {
  store: BootsStore;
  sync: PatternSync;
  library: PatternLibrary;
  storage: ReturnType<typeof memoryStorage>;
  left: FakeBoot;
  right: FakeBoot;
  leftRecipes: RecipeBoot;
  rightRecipes: RecipeBoot;
  setCatalog(catalog: CatalogJson): Promise<void>;
  stop(): Promise<void>;
}

const rigs: Rig[] = [];
afterEach(async () => {
  await Promise.all(rigs.splice(0).map((rig) => rig.stop()));
});

async function rig({
  catalog,
  storage = memoryStorage(),
  left: leftOptions = {},
  right: rightOptions = {},
  leftRecipes: leftRecipeOptions = {},
  rightRecipes: rightRecipeOptions = {},
  boots,
}: {
  catalog?: CatalogJson | null;
  storage?: ReturnType<typeof memoryStorage>;
  left?: ConstructorParameters<typeof FakeBoot>[0];
  right?: ConstructorParameters<typeof FakeBoot>[0];
  leftRecipes?: ConstructorParameters<typeof RecipeBoot>[0];
  rightRecipes?: ConstructorParameters<typeof RecipeBoot>[0];
  boots?: { left: FakeBoot; right: FakeBoot; leftRecipes: RecipeBoot; rightRecipes: RecipeBoot };
} = {}): Promise<Rig> {
  const left = boots?.left ?? new FakeBoot({ id: "3ED1", ...leftOptions });
  const right = boots?.right ?? new FakeBoot({ id: "7B20", ...rightOptions });
  left.replyDelayMs = right.replyDelayMs = 1;
  const leftRecipes = boots?.leftRecipes ?? attachRecipes(left, new RecipeBoot({ id: left.id, proto: left.proto, ...leftRecipeOptions }));
  const rightRecipes = boots?.rightRecipes ?? attachRecipes(right, new RecipeBoot({ id: right.id, proto: right.proto, ...rightRecipeOptions }));
  storage.data.set("boots", JSON.stringify([
    { side: "left", deviceId: left.deviceId, name: left.name },
    { side: "right", deviceId: right.deviceId, name: right.name },
  ]));

  let served = catalog === null ? null : catalogJson(catalog ?? (await realCatalog()));
  const library = new PatternLibrary(storage, async () => {
    if (served === null) throw new Error("offline");
    return served;
  });
  const store = new BootsStore(new FakeTransport([left, right]), storage);
  await store.load();
  await library.load();
  const sync = new PatternSync(store, library, storage);
  const stopSync = sync.start();
  await library.refresh();

  const made: Rig = {
    store, sync, library, storage, left, right, leftRecipes, rightRecipes,
    async setCatalog(next) {
      served = catalogJson(next);
      await library.refresh();
    },
    async stop() {
      stopSync();
      await Promise.all(store.sides().map((side) => store.client(side)?.disconnect()));
    },
  };
  rigs.push(made);
  return made;
}

const synced = (rig: Rig, side: "left" | "right") => rig.sync.state(side)?.phase === "done";
const bothSynced = (rig: Rig) => synced(rig, "left") && synced(rig, "right");
const begins = (boot: FakeBoot) => boot.received.filter((line) => line.startsWith("recipe begin"));
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

describe("PatternSync", () => {
  it("puts every catalog pattern on both boots when they connect, selecting none", async () => {
    const catalog = await realCatalog();
    const test = await rig({ catalog });
    await waitFor(() => bothSynced(test), "both boots to sync");

    for (const recipes of [test.leftRecipes, test.rightRecipes]) {
      expect([...recipes.stored.keys()].sort()).toEqual(catalog.patterns.map((entry) => entry.name));
      for (const entry of catalog.patterns) expect(hex(recipes.stored.get(entry.name)!)).toBe(entry.data);
    }
    for (const boot of [test.left, test.right]) {
      expect(boot.received.filter((line) => line.startsWith("pattern "))).toEqual([]);
      expect(boot.pattern).toBe("rainbow-pool");
    }
    // The new patterns show up as tiles without a reconnect.
    await waitFor(() => test.store.client("left")!.getState().patterns.includes("lava-pour"), "the tiles to update");
  });

  it("syncs once per connection, not on every status line", async () => {
    const test = await rig();
    await waitFor(() => bothSynced(test));
    const asked = test.left.received.filter((line) => line === "recipes").length;
    test.store.client("left")!.requestStatus();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(test.left.received.filter((line) => line === "recipes").length).toBe(asked);
  });

  it("uploads nothing on a later connection when the boot is already up to date", async () => {
    const test = await rig();
    await waitFor(() => bothSynced(test));
    const uploaded = begins(test.left).length;

    test.left.dropLink();
    await waitFor(() => test.store.client("left")!.getState().link === "online", "the reconnect", 6000);
    await waitFor(() => test.left.received.filter((line) => line === "recipes").length === 2, "the second check");
    await waitFor(() => synced(test, "left"));
    expect(begins(test.left).length).toBe(uploaded);
  });

  it("syncs again when a newer catalog arrives while connected", async () => {
    const catalog = await realCatalog();
    const test = await rig({ catalog });
    await waitFor(() => bothSynced(test));

    const comet = catalog.patterns.find((entry) => entry.name === "comet")!;
    const tweaked = structuredClone(comet.recipe) as Recipe;
    (tweaked.layers[0] as { brightness: number }).brightness = 0.5;
    const compiled = compileRecipe(tweaked);
    if (!compiled.ok) throw new Error(compiled.errors.join(" "));
    const next = structuredClone(catalog);
    next.patterns = next.patterns
      .filter((entry) => entry.name !== "starfield")
      .map((entry) => entry.name === "comet" ? { ...entry, bytes: compiled.bytes.length, crc: compiledCrc(compiled.bytes), data: hex(compiled.bytes), recipe: tweaked } : entry);
    const before = begins(test.left).length;

    await test.setCatalog(next);
    await waitFor(() => !test.leftRecipes.stored.has("starfield"), "starfield to leave the boot");
    await waitFor(() => synced(test, "left"));

    expect(hex(test.leftRecipes.stored.get("comet")!)).toBe(hex(compiled.bytes));
    expect(begins(test.left).length).toBe(before + 1);
  });

  it("leaves a designer experiment alone", async () => {
    const test = await rig();
    const experiment = (await realCatalog()).patterns[0]!;
    // An upload this phone never put there, under a name main doesn't have.
    test.leftRecipes.stored.set("my-test", Uint8Array.from(experiment.data.match(/../g)!.map((pair) => parseInt(pair, 16))));
    await waitFor(() => bothSynced(test));
    expect(test.leftRecipes.stored.has("my-test")).toBe(true);
  });

  it("resets a designer experiment that reuses a main pattern's name to main's version", async () => {
    const catalog = await realCatalog();
    const lava = catalog.patterns.find((entry) => entry.name === "lava-pour")!;
    const experiment = structuredClone(lava.recipe) as Recipe;
    experiment.layers[0]!.opacity = 0.25;
    const compiled = compileRecipe(experiment);
    if (!compiled.ok) throw new Error(compiled.errors.join(" "));

    const left = new FakeBoot({ id: "3ED1" });
    const right = new FakeBoot({ id: "7B20" });
    const leftRecipes = attachRecipes(left, new RecipeBoot({ id: left.id, proto: left.proto }));
    const rightRecipes = attachRecipes(right, new RecipeBoot({ id: right.id, proto: right.proto }));
    leftRecipes.stored.set("lava-pour", compiled.bytes);

    const test = await rig({ catalog, boots: { left, right, leftRecipes, rightRecipes } });
    await waitFor(() => bothSynced(test));
    expect(hex(leftRecipes.stored.get("lava-pour")!)).toBe(lava.data);
  });

  it("deletes a pattern it synced earlier once main drops it, even after the app restarts", async () => {
    const catalog = await realCatalog();
    const storage = memoryStorage();
    const first = await rig({ catalog, storage });
    await waitFor(() => bothSynced(first));
    const boots = { left: first.left, right: first.right, leftRecipes: first.leftRecipes, rightRecipes: first.rightRecipes };
    await first.stop();
    rigs.splice(rigs.indexOf(first), 1);
    expect(storage.data.get(onBootKey("3ED1"))).toContain("starfield");

    const dropped = { ...catalog, patterns: catalog.patterns.filter((entry) => entry.name !== "starfield") };
    const second = await rig({ catalog: dropped, storage, boots });
    await waitFor(() => !boots.leftRecipes.stored.has("starfield"), "starfield to be deleted");
    await waitFor(() => bothSynced(second));
    expect(storage.data.get(onBootKey("3ED1"))).not.toContain("starfield");
  });

  it("holds back patterns the boot's firmware can't read and says how many", async () => {
    const catalog = await realCatalog();
    const newer = catalog.patterns.filter((entry) => entry.recipeVersion > 1).map((entry) => entry.name);
    expect(newer.length).toBeGreaterThan(0);
    const test = await rig({ catalog, leftRecipes: { versions: [1] } });
    await waitFor(() => bothSynced(test));

    for (const name of newer) expect(test.leftRecipes.stored.has(name)).toBe(false);
    expect(test.sync.state("left")).toMatchObject({ needsFirmware: newer.length });
    expect(test.sync.view(["left", "right"]).needsFirmware).toEqual([{ side: "left", count: newer.length }]);
  });

  it("uploads what fits when slots run out and says how many didn't", async () => {
    const catalog = await realCatalog();
    const test = await rig({ catalog, rightRecipes: { slots: 3 } });
    await waitFor(() => bothSynced(test));
    expect(test.rightRecipes.stored.size).toBe(3);
    expect(test.sync.view(["right"]).noRoom).toEqual([{ side: "right", count: catalog.patterns.length - 3 }]);
  });

  it("leaves firmware without recipe commands alone", async () => {
    const test = await rig({ left: { proto: 2 } });
    await waitFor(() => synced(test, "right"));
    expect(test.left.received.some((line) => line.startsWith("recipe"))).toBe(false);
    expect(test.sync.state("left")).toBeUndefined();
  });

  it("waits for a catalog before syncing", async () => {
    const test = await rig({ catalog: null });
    await waitFor(() => test.store.client("left")!.getState().link === "online");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(test.left.received.some((line) => line.startsWith("recipe"))).toBe(false);
  });

  it("reports progress while it runs", async () => {
    const test = await rig();
    const seen: string[] = [];
    test.sync.subscribe(() => {
      const progress = test.sync.view(["left"]).progress;
      if (progress) seen.push(`${progress.done}/${progress.total}`);
    });
    await waitFor(() => bothSynced(test));
    const total = (await realCatalog()).patterns.length;
    expect(seen).toContain(`0/${total}`);
    expect(seen).toContain(`${total - 1}/${total}`);
    expect(test.sync.view(["left"]).progress).toBeUndefined();
  });

  // Both boots sync the same catalog at once, so the pair reads "3 of 7", not 6 of 14.
  it("follows the boot with the most left to do when both are syncing", async () => {
    const test = await rig();
    const totals = new Set<number>();
    test.sync.subscribe(() => {
      const progress = test.sync.view(["left", "right"]).progress;
      if (progress) totals.add(progress.total);
    });
    await waitFor(() => bothSynced(test));
    expect([...totals]).toEqual([(await realCatalog()).patterns.length]);
  });

  // Each recipe gets its own turn in the boot's command queue, so a brightness drag mid-sync
  // reaches the boot between two recipes instead of waiting for all of them.
  it("lets a tap through between recipes", async () => {
    const test = await rig();
    await waitFor(() => begins(test.left).length === 1, "the first upload");
    test.store.client("left")!.setBrightness(40);
    await waitFor(() => bothSynced(test));
    const lines = test.left.received;
    const brightness = lines.findIndex((line) => line.startsWith("brightness"));
    const lastBegin = lines.length - 1 - [...lines].reverse().findIndex((line) => line.startsWith("recipe begin"));
    expect(brightness).toBeGreaterThan(-1);
    expect(brightness).toBeLessThan(lastBegin);
  });

  describe("pause and resume", () => {
    it("lets the recipe being sent finish, starts no new one, and carries on after resume", async () => {
      const test = await rig();
      await waitFor(() => begins(test.left).length === 1, "the first upload");
      test.sync.pause("left");
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(begins(test.left).length).toBe(1);
      expect(test.left.received.at(-1)).not.toMatch(/^recipe (begin|data)/);
      expect(test.leftRecipes.stored.size).toBe(1);
      expect(synced(test, "left")).toBe(false);
      // The other boot isn't held up.
      await waitFor(() => synced(test, "right"));

      test.sync.resume("left");
      await waitFor(() => synced(test, "left"));
      expect(test.leftRecipes.stored.size).toBe((await realCatalog()).patterns.length);
      expect(begins(test.left).length).toBe((await realCatalog()).patterns.length);
    });

    it("keeps a paused boot from starting a sync at all", async () => {
      const test = await rig({ catalog: null });
      await waitFor(() => test.store.client("left")!.getState().link === "online");
      test.sync.pause("left");
      await test.setCatalog(await realCatalog());
      await waitFor(() => synced(test, "right"));
      expect(test.left.received.some((line) => line.startsWith("recipe"))).toBe(false);
      test.sync.resume("left");
      await waitFor(() => synced(test, "left"));
    });
  });
});
