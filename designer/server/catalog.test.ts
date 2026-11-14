// The pattern catalog the iPhone app syncs to boots. These check the builder against scratch
// folders, and against the real patterns/ folder, so a recipe that can't go in the catalog fails CI
// before it reaches main.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCatalog, catalogJson } from "./catalog";
import { compileRecipe, decodeRecipe } from "../src/recipe/compile";
import { recipeToJson } from "../src/recipe/serialize";
import type { Recipe } from "../src/recipe/types";
import { compiledCrc } from "../../shared/recipeBinary";

const PATTERNS_DIR = fileURLToPath(new URL("../../patterns", import.meta.url));

const recipe = (name: string, description = `${name} test`): Recipe => ({
  format: "firewalker-recipe",
  version: 1,
  name,
  description,
  layers: [{ type: "fill", enabled: true, palette: ["#ff0000"], spread: "ring", repeat: 1, offset: 0, scroll: 0, brightness: 1, blend: "over", opacity: 1 }],
});

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

describe("buildCatalog", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "catalog-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("compiles every recipe in the folder, sorted by name, with its source", async () => {
    await writeFile(path.join(dir, "zebra.json"), recipeToJson(recipe("zebra")));
    await writeFile(path.join(dir, "apple.json"), recipeToJson(recipe("apple", "Red all over.")));

    const catalog = await buildCatalog(dir, "abc123");

    expect(catalog).toMatchObject({ format: "firewalker-catalog", version: 1, commit: "abc123" });
    expect(catalog.patterns.map((entry) => entry.name)).toEqual(["apple", "zebra"]);
    const apple = catalog.patterns[0]!;
    const compiled = compileRecipe(recipe("apple", "Red all over."));
    if (!compiled.ok) throw new Error("test recipe should compile");
    expect(apple).toEqual({
      name: "apple",
      description: "Red all over.",
      recipeVersion: 1,
      bytes: compiled.bytes.length,
      crc: compiledCrc(compiled.bytes),
      data: hex(compiled.bytes),
      recipe: recipe("apple", "Red all over."),
    });
  });

  it("refuses to build when any recipe is broken, naming it", async () => {
    await writeFile(path.join(dir, "good.json"), recipeToJson(recipe("good")));
    await writeFile(path.join(dir, "bad.json"), "{ not json");
    await expect(buildCatalog(dir, "abc123")).rejects.toThrow(/bad/);
  });

  it("refuses a recipe that's too big for a boot", async () => {
    const huge = recipe("huge");
    huge.layers = Array.from({ length: 8 }, () => ({
      type: "fill", enabled: true, palette: Array.from({ length: 16 }, () => "#ff0000"), spread: "ring", repeat: 1, offset: 0, scroll: 0, brightness: 1, blend: "over", opacity: 1,
    })) as Recipe["layers"];
    await writeFile(path.join(dir, "huge.json"), recipeToJson(huge));
    await expect(buildCatalog(dir, "abc123")).rejects.toThrow(/huge/);
  });

  it("writes the same file every time for the same folder and commit", async () => {
    await writeFile(path.join(dir, "apple.json"), recipeToJson(recipe("apple")));
    const first = catalogJson(await buildCatalog(dir, "abc123"));
    const second = catalogJson(await buildCatalog(dir, "abc123"));
    expect(second).toBe(first);
    expect(first.endsWith("\n")).toBe(true);
  });
});

describe("the catalog of the real patterns/ folder", () => {
  it("holds every kept recipe, each decoding back to itself", async () => {
    const catalog = await buildCatalog(PATTERNS_DIR, "test");
    expect(catalog.patterns.length).toBeGreaterThan(0);
    for (const entry of catalog.patterns) {
      const bytes = Uint8Array.from(entry.data.match(/../g)!.map((pair) => parseInt(pair, 16)));
      const decoded = decodeRecipe(bytes);
      expect(decoded.ok ? decoded.recipe.name : decoded.error).toBe(entry.name);
      expect(bytes[0]).toBe(entry.recipeVersion);
    }
  });

  // A boot has 16 upload slots, and sync puts every catalog recipe in one, built-ins included.
  // docs/adr/0007-sync-patterns-from-main.md has the firmware change that would lift this.
  it("fits in a boot's 16 upload slots", async () => {
    expect((await buildCatalog(PATTERNS_DIR, "test")).patterns.length).toBeLessThanOrEqual(16);
  });
});
