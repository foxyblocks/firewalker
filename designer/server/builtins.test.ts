import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import { currentBuiltinsHeader, readBuiltInNames, renameBuiltIn } from "./builtins";
import { deletePattern, listPatterns, savePattern } from "./patternStore";
import { MAX_BUILT_INS, parseBuiltInList, renameInBuiltInList } from "../src/recipe/generateBuiltins";
import { recipeToJson } from "../src/recipe/serialize";
import { newLayer } from "../src/recipe/spec";
import type { Recipe } from "../src/recipe/types";

let dir: string;
let header: string;

function recipe(name: string, description = ""): Recipe {
  return { format: "firewalker-recipe", version: 1, name, description, layers: [newLayer("fill")] };
}

async function headerText(): Promise<string | null> {
  return readFile(header, "utf8").catch(() => null);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "built-ins-"));
  header = path.join(dir, "header.h");
  await writeFile(path.join(dir, "glow.json"), recipeToJson(recipe("glow")));
  await writeFile(path.join(dir, "spark.json"), recipeToJson(recipe("spark")));
  await writeFile(path.join(dir, "built-ins.txt"), "# A comment.\n\nglow\n");
});

describe("the built-ins list", () => {
  it("reads names, skipping comments and blank lines", () => {
    expect(parseBuiltInList("# hi\n\n comet \nfire-stomp\n")).toEqual(["comet", "fire-stomp"]);
  });

  it("changes a name, keeping everything else as written", () => {
    expect(renameInBuiltInList("# hi\ncomet\nglow\n", "comet", "ember")).toBe("# hi\nember\nglow\n");
    expect(renameInBuiltInList("# hi\ncomet\nglow\n", "comet", null)).toBe("# hi\nglow\n");
  });

  it("marks built-in recipes in the pattern list", async () => {
    const patterns = await listPatterns(dir);
    expect(patterns.map((p) => [p.name, p.builtIn ?? false])).toEqual([
      ["glow", true],
      ["spark", false],
    ]);
  });

  it("treats a folder with no list as having no built-ins", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "no-list-"));
    expect(await readBuiltInNames(empty)).toEqual([]);
    expect(await renameBuiltIn(empty, "glow", "ember")).toBe(false);
  });
});

describe("the built-ins header", () => {
  it("holds each listed recipe's compiled bytes, and no others", async () => {
    const text = await currentBuiltinsHeader(dir);
    expect(text).toContain('{"glow", BUILTIN_GLOW,');
    expect(text).not.toContain("spark");
    expect(text).toContain("RECIPE_BUILTIN_COUNT = 1");
  });

  it("carries a hash of the list and its recipes, which a firmware build recomputes", async () => {
    const list = await readFile(path.join(dir, "built-ins.txt"));
    const file = await readFile(path.join(dir, "glow.json"));
    const expected = createHash("sha256").update(list).update(file).digest("hex");
    expect(await currentBuiltinsHeader(dir)).toContain(`source-hash: ${expected}`);
  });

  it("names the recipe when the list points at nothing", async () => {
    await writeFile(path.join(dir, "built-ins.txt"), "ghost\n");
    await expect(currentBuiltinsHeader(dir)).rejects.toThrow(/ghost/);
  });

  it("refuses too many built-ins", async () => {
    const names = Array.from({ length: MAX_BUILT_INS + 1 }, (_, i) => `r${i}`);
    for (const name of names) await writeFile(path.join(dir, `${name}.json`), recipeToJson(recipe(name)));
    await writeFile(path.join(dir, "built-ins.txt"), names.join("\n"));
    await expect(currentBuiltinsHeader(dir)).rejects.toThrow(/The most is/);
  });

  it("copes with an empty list", async () => {
    await writeFile(path.join(dir, "built-ins.txt"), "# Nothing yet.\n");
    const text = await currentBuiltinsHeader(dir);
    expect(text).toContain("RECIPE_BUILTIN_COUNT = 0");
    expect(text).toContain('{"", nullptr, 0}');
  });

  it("matches the repo's checked-in header (bun run build-recipes rewrites it)", async () => {
    const repo = fileURLToPath(new URL("../../", import.meta.url));
    const checkedIn = await readFile(path.join(repo, "include/generated/recipe_builtins.h"), "utf8");
    expect(checkedIn).toBe(await currentBuiltinsHeader(path.join(repo, "patterns")));
  });
});

describe("saving and deleting", () => {
  it("rewrites the header when a built-in is saved", async () => {
    await savePattern(dir, "glow", recipe("glow", "warmer"), undefined, undefined, header);
    expect(await headerText()).toContain('{"glow", BUILTIN_GLOW,');
  });

  it("leaves the header alone when any other recipe is saved", async () => {
    await savePattern(dir, "spark", recipe("spark", "brighter"), undefined, undefined, header);
    expect(await headerText()).toBeNull();
  });

  it("leaves the header alone in a folder that doesn't have one", async () => {
    await savePattern(dir, "glow", recipe("glow", "warmer"));
    expect(await headerText()).toBeNull();
  });

  it("moves a renamed built-in on the list, and rewrites the header", async () => {
    await savePattern(dir, "ember", recipe("ember"), "glow", undefined, header);
    expect(await readBuiltInNames(dir)).toEqual(["ember"]);
    expect(await headerText()).toContain('{"ember", BUILTIN_EMBER,');
    expect(await readFile(path.join(dir, "built-ins.txt"), "utf8")).toContain("# A comment.");
  });

  it("takes a deleted built-in off the list, and rewrites the header", async () => {
    await deletePattern(dir, "glow", header);
    expect(await readBuiltInNames(dir)).toEqual([]);
    expect(await headerText()).toContain("RECIPE_BUILTIN_COUNT = 0");
  });

  it("leaves the list and header alone when another recipe is deleted", async () => {
    await deletePattern(dir, "spark", header);
    expect(await readBuiltInNames(dir)).toEqual(["glow"]);
    expect(await headerText()).toBeNull();
  });
});
