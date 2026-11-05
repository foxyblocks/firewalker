// Reads and writes recipe files in the repo's patterns/ folder, one `<name>.json` per pattern.
// The dev server calls these for the designer's Save, Delete, and pattern list. Every write is
// validated first, and names are checked before they touch a path, so nothing outside the
// folder can be read or written.

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { recipeToJson } from "../src/recipe/serialize.ts";
import type { Recipe } from "../src/recipe/types.ts";
import { nameProblem, validateRecipe } from "../src/recipe/validate.ts";

export interface StoredPattern {
  name: string;
  recipe: Recipe | null;
  // Why the file couldn't be used, when recipe is null.
  errors?: string[];
}

export class PatternStoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: string[] = [],
  ) {
    super(message);
  }
}

export async function listPatterns(dir: string): Promise<StoredPattern[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const patterns: StoredPattern[] = [];
  for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
    const name = file.slice(0, -".json".length);
    if (nameProblem(name)) {
      patterns.push({ name, recipe: null, errors: [`The file name isn't a valid pattern name: ${nameProblem(name)}`] });
      continue;
    }
    try {
      const result = validateRecipe(JSON.parse(await readFile(path.join(dir, file), "utf8")));
      if (!result.ok) {
        patterns.push({ name, recipe: null, errors: result.errors });
      } else if (result.recipe.name !== name) {
        patterns.push({ name, recipe: null, errors: [`The file says its name is "${result.recipe.name}".`] });
      } else {
        patterns.push({ name, recipe: result.recipe });
      }
    } catch (error) {
      patterns.push({ name, recipe: null, errors: [`Not valid JSON: ${(error as Error).message}`] });
    }
  }
  return patterns;
}

// Writes a recipe to `<name>.json`. With `replaces`, the old file goes once the new one is
// written, which is how a rename saves.
export async function savePattern(dir: string, name: string, body: unknown, replaces?: string): Promise<Recipe> {
  checkName(name);
  if (replaces !== undefined) checkName(replaces);

  const result = validateRecipe(body);
  if (!result.ok) throw new PatternStoreError("The recipe isn't valid.", 422, result.errors);
  if (result.recipe.name !== name) throw new PatternStoreError("The recipe's name doesn't match its file.", 422);

  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `${name}.json`);
  // Write beside the target, then rename over it, so a crash never leaves half a file.
  const temporary = path.join(dir, `.${name}.json.tmp`);
  await writeFile(temporary, recipeToJson(result.recipe), "utf8");
  await rename(temporary, target);

  if (replaces !== undefined && replaces !== name) {
    await rm(path.join(dir, `${replaces}.json`), { force: true });
  }
  return result.recipe;
}

export async function deletePattern(dir: string, name: string): Promise<void> {
  checkName(name);
  await rm(path.join(dir, `${name}.json`), { force: true });
}

function checkName(name: string): void {
  const problem = nameProblem(name);
  if (problem) throw new PatternStoreError(problem, 400);
}
