import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCatalog, catalogJson } from "../../../designer/server/catalog";
import type { CatalogJson } from "../../../shared/patternCatalog";
import { catalogFingerprint, parseCatalog } from "./catalog";

// Real catalogs, built by the designer from the repo's patterns/ folder, so these tests also
// catch the builder and the phone drifting apart.
const PATTERNS_DIR = fileURLToPath(new URL("../../../patterns", import.meta.url));
const real = async (): Promise<CatalogJson> => buildCatalog(PATTERNS_DIR, "abc123");

const edited = async (edit: (catalog: CatalogJson) => void): Promise<string> => {
  const catalog = structuredClone(await real());
  edit(catalog);
  return JSON.stringify(catalog);
};

describe("parseCatalog", () => {
  it("reads every pattern as a canonical library entry with its compiled bytes", async () => {
    const catalog = await real();
    const parsed = parseCatalog(catalogJson(catalog));
    if (!parsed.ok) throw new Error(parsed.error);

    expect(parsed.catalog.commit).toBe("abc123");
    expect(parsed.catalog.patterns.map((pattern) => pattern.name)).toEqual(catalog.patterns.map((entry) => entry.name));
    const comet = parsed.catalog.patterns.find((pattern) => pattern.name === "comet")!;
    const source = catalog.patterns.find((entry) => entry.name === "comet")!;
    expect(comet).toMatchObject({ origin: "canonical", description: source.description, recipeVersion: source.recipeVersion, crc: source.crc });
    expect(comet.bytes).toBeInstanceOf(Uint8Array);
    expect(comet.bytes.length).toBe(source.bytes);
    expect(comet.recipe).toEqual(source.recipe);
  });

  it.each([
    ["isn't JSON", async () => "{ nope"],
    ["isn't a catalog", async () => JSON.stringify({ format: "firewalker-recipe", version: 1 })],
    ["is a newer format than this app reads", () => edited((catalog) => { (catalog as { version: number }).version = 2; })],
    ["has no commit", () => edited((catalog) => { delete (catalog as Partial<CatalogJson>).commit; })],
    ["has an entry whose bytes fail their checksum", () => edited((catalog) => {
      const entry = catalog.patterns[0]!;
      entry.data = `${entry.data.slice(0, 10)}${entry.data[10] === "0" ? "1" : "0"}${entry.data.slice(11)}`;
    })],
    ["has an entry whose crc field disagrees with its bytes", () => edited((catalog) => { catalog.patterns[0]!.crc = "00000000"; })],
    ["has an entry whose size disagrees with its bytes", () => edited((catalog) => { catalog.patterns[0]!.bytes += 1; })],
    ["has an entry with an illegal name", () => edited((catalog) => { catalog.patterns[0]!.name = "Off Road"; })],
    ["has an entry named differently from its bytes", () => edited((catalog) => {
      catalog.patterns[0]!.name = catalog.patterns[1]!.name;
      catalog.patterns.splice(1, 1);
    })],
    ["has two entries with one name", () => edited((catalog) => { catalog.patterns.push(catalog.patterns[0]!); })],
    ["has an entry whose version disagrees with its bytes", () => edited((catalog) => { catalog.patterns[0]!.recipeVersion = 9; })],
    ["has an entry whose data isn't hex", () => edited((catalog) => { catalog.patterns[0]!.data = "zz"; })],
    ["has an entry with no source recipe", () => edited((catalog) => { delete (catalog.patterns[0] as Partial<CatalogJson["patterns"][0]>).recipe; })],
  ])("refuses a catalog that %s", async (_reason, make) => {
    const parsed = parseCatalog(await make());
    expect(parsed.ok).toBe(false);
  });

  it("says which pattern is wrong", async () => {
    const parsed = parseCatalog(await edited((catalog) => { catalog.patterns[0]!.crc = "00000000"; }));
    expect(parsed.ok ? "" : parsed.error).toContain((await real()).patterns[0]!.name);
  });
});

describe("catalogFingerprint", () => {
  const parse = (text: string) => {
    const parsed = parseCatalog(text);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.catalog;
  };

  // A push to main that changes no pattern publishes a new commit, which mustn't make every
  // phone sync again.
  it("ignores the commit", async () => {
    const a = parse(JSON.stringify(await real()));
    const b = parse(await edited((catalog) => { catalog.commit = "def456"; }));
    expect(catalogFingerprint(b)).toBe(catalogFingerprint(a));
  });

  it("changes when a pattern is added, removed, or changed", async () => {
    const base = catalogFingerprint(parse(JSON.stringify(await real())));
    expect(catalogFingerprint(parse(await edited((catalog) => { catalog.patterns.pop(); })))).not.toBe(base);
    const changed = parse(JSON.stringify(await real()));
    changed.patterns[0] = { ...changed.patterns[0]!, crc: "ffffffff" };
    expect(catalogFingerprint(changed)).not.toBe(base);
  });
});
