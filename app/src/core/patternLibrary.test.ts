import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCatalog, catalogJson } from "../../../designer/server/catalog";
import type { CatalogJson } from "../../../shared/patternCatalog";
import type { KeyValueStore } from "./boots";
import { LIBRARY_KEYS, PatternLibrary, wantedRecipes, type LibraryPattern } from "./patternLibrary";

const PATTERNS_DIR = fileURLToPath(new URL("../../../patterns", import.meta.url));
const catalogText = async (edit: (catalog: CatalogJson) => void = () => undefined): Promise<string> => {
  const catalog = await buildCatalog(PATTERNS_DIR, "abc123");
  edit(catalog);
  return catalogJson(catalog);
};

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

describe("PatternLibrary", () => {
  it("starts empty with nothing cached", async () => {
    const library = new PatternLibrary(memoryStorage(), async () => { throw new Error("offline"); });
    await library.load();
    expect(library.canonical()).toEqual([]);
    expect(library.fingerprint()).toBeNull();
  });

  it("downloads the catalog, keeps it, and tells subscribers", async () => {
    const storage = memoryStorage();
    const text = await catalogText();
    const library = new PatternLibrary(storage, async () => text);
    await library.load();
    let notified = 0;
    library.subscribe(() => notified++);

    await library.refresh();

    expect(library.canonical().map((pattern) => pattern.name)).toContain("comet");
    expect(library.canonical().every((pattern) => pattern.origin === "canonical")).toBe(true);
    expect(storage.data.get(LIBRARY_KEYS.canonical)).toBe(text);
    expect(notified).toBe(1);
  });

  it("works from the kept copy with no signal", async () => {
    const storage = memoryStorage({ [LIBRARY_KEYS.canonical]: await catalogText() });
    const library = new PatternLibrary(storage, async () => { throw new Error("offline"); });
    await library.load();
    await library.refresh();
    expect(library.canonical().map((pattern) => pattern.name)).toContain("comet");
  });

  it("keeps the copy it had when a download is broken", async () => {
    const good = await catalogText();
    const storage = memoryStorage({ [LIBRARY_KEYS.canonical]: good });
    const library = new PatternLibrary(storage, async () => good.replace(/"crc": "[0-9a-f]{8}"/, '"crc": "00000000"'));
    await library.load();
    await library.refresh();
    expect(library.canonical().length).toBeGreaterThan(0);
    expect(storage.data.get(LIBRARY_KEYS.canonical)).toBe(good);
  });

  it("ignores a kept copy that no longer parses", async () => {
    const library = new PatternLibrary(memoryStorage({ [LIBRARY_KEYS.canonical]: "{ broken" }), async () => { throw new Error("offline"); });
    await library.load();
    expect(library.canonical()).toEqual([]);
  });

  it("replaces main's patterns wholesale with a newer catalog", async () => {
    let text = await catalogText();
    const library = new PatternLibrary(memoryStorage(), async () => text);
    await library.refresh();
    const before = library.fingerprint();
    text = await catalogText((catalog) => { catalog.patterns = catalog.patterns.filter((entry) => entry.name !== "comet"); });

    await library.refresh();

    expect(library.canonical().map((pattern) => pattern.name)).not.toContain("comet");
    expect(library.fingerprint()).not.toBe(before);
  });

  it("doesn't notify when a download has the same patterns", async () => {
    const library = new PatternLibrary(memoryStorage(), async () => catalogText());
    await library.refresh();
    let notified = 0;
    library.subscribe(() => notified++);
    await library.refresh();
    expect(notified).toBe(0);
  });

  it("gives up on a download that never finishes", async () => {
    const library = new PatternLibrary(memoryStorage(), () => new Promise(() => undefined), { timeoutMs: 20 });
    await library.refresh();
    expect(library.canonical()).toEqual([]);
  });

  it("shares one download between overlapping refreshes", async () => {
    let downloads = 0;
    const text = await catalogText();
    const library = new PatternLibrary(memoryStorage(), async () => {
      downloads++;
      return text;
    });
    await Promise.all([library.refresh(), library.refresh()]);
    expect(downloads).toBe(1);
  });

  it("describes main's patterns by name", async () => {
    const text = await catalogText();
    const library = new PatternLibrary(memoryStorage(), async () => text);
    await library.refresh();
    expect(library.description("comet")).toMatch(/comet/i);
    expect(library.description("not-there")).toBeUndefined();
  });
});

describe("wantedRecipes", () => {
  const pattern = (name: string, origin: LibraryPattern["origin"], crc: string): LibraryPattern => ({
    name, origin, crc, recipeVersion: 1, bytes: new Uint8Array(), description: "", recipe: {},
  });

  it("puts main's patterns first, then the person's own", () => {
    const wanted = wantedRecipes([pattern("comet", "canonical", "aaaaaaaa")], [pattern("my-glow", "mine", "bbbbbbbb")]);
    expect(wanted.map((recipe) => [recipe.name, recipe.origin])).toEqual([["comet", "canonical"], ["my-glow", "mine"]]);
  });

  it("lets main's pattern win a name", () => {
    const wanted = wantedRecipes([pattern("comet", "canonical", "aaaaaaaa")], [pattern("comet", "mine", "bbbbbbbb")]);
    expect(wanted).toHaveLength(1);
    expect(wanted[0]).toMatchObject({ origin: "canonical", crc: "aaaaaaaa" });
  });
});
