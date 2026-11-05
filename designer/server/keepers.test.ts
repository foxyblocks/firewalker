// Checks the real recipes in the repo's patterns/ folder, not test data. The designer checks a
// recipe when it saves one, but a hand edit or a merge can still leave a bad file behind, and
// without this the only sign would be a banner the next time someone opens the designer. These
// recipes are also what the firmware's engine will run, so a bad one matters.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { listPatterns } from "./patternStore";
import { compileRecipe } from "../src/recipe/compile";
import { recipeToJson } from "../src/recipe/serialize";
import type { Recipe } from "../src/recipe/types";

const PATTERNS_DIR = fileURLToPath(new URL("../../patterns", import.meta.url));
const FILES = readdirSync(PATTERNS_DIR).filter((file) => file.endsWith(".json")).sort();

describe("patterns/", () => {
  it("has recipes to check", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it.each(FILES)("%s is a valid recipe named after its file", async (file) => {
    const pattern = (await listPatterns(PATTERNS_DIR)).find((p) => `${p.name}.json` === file);
    // Comparing the errors, not just the recipe, makes a failure say what's wrong with the file.
    expect(pattern?.errors).toBeUndefined();
    expect(pattern?.recipe?.name).toBe(file.replace(/\.json$/, ""));
  });

  it.each(FILES)("%s compiles to fit on a boot", (file) => {
    const compiled = compileRecipe(JSON.parse(readFileSync(path.join(PATTERNS_DIR, file), "utf8")) as Recipe);
    expect(compiled.ok ? [] : compiled.errors).toEqual([]);
  });

  // The fixed field order and spacing is what keeps a recipe's diffs small.
  it.each(FILES)("%s is written the way the designer writes it", (file) => {
    const text = readFileSync(path.join(PATTERNS_DIR, file), "utf8");
    expect(text).toBe(recipeToJson(JSON.parse(text) as Recipe));
  });
});
