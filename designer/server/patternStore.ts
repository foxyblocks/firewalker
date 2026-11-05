// Reads and writes recipe files in the repo's patterns/ folder, one `<name>.json` per pattern.
// The dev server calls these for the designer's Save, Delete, and pattern list. Every write is
// validated first, and names are checked before they touch a path, so nothing outside the
// folder can be read or written.
//
// Each file has a version, a hash of its contents. The designer remembers the version a draft
// started from and sends it with the save, so a file changed behind the designer's back, such
// as by a git pull, stops the save instead of being overwritten.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { recipeToJson } from "../src/recipe/serialize.ts";
import type { Recipe } from "../src/recipe/types.ts";
import { nameProblem, validateRecipe } from "../src/recipe/validate.ts";

export interface StoredPattern {
  name: string;
  recipe: Recipe | null;
  // Identifies the file's exact contents, so it changes whenever the file does.
  version?: string;
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
    const text = await readFile(path.join(dir, file), "utf8");
    const version = fileVersion(text);
    try {
      const result = validateRecipe(JSON.parse(text));
      if (!result.ok) {
        patterns.push({ name, recipe: null, version, errors: result.errors });
      } else if (result.recipe.name !== name) {
        patterns.push({ name, recipe: null, version, errors: [`The file says its name is "${result.recipe.name}".`] });
      } else {
        patterns.push({ name, recipe: result.recipe, version });
      }
    } catch (error) {
      patterns.push({ name, recipe: null, version, errors: [`Not valid JSON: ${(error as Error).message}`] });
    }
  }
  return patterns;
}

// Writes a recipe to `<name>.json` and returns it with the file's new version. With `replaces`,
// the old file goes once the new one is written, which is how a rename saves.
//
// `expected` says what the caller believes is on disk, and a wrong belief fails with status 409
// before anything is written. A version means the file being saved over (`replaces`, or else
// `name`) still has that version. Null means this is a new pattern, so `<name>.json` shouldn't
// exist yet. Leaving it out writes without checking.
export async function savePattern(
  dir: string,
  name: string,
  body: unknown,
  replaces?: string,
  expected?: string | null,
): Promise<{ recipe: Recipe; version: string }> {
  checkName(name);
  if (replaces !== undefined) checkName(replaces);

  const result = validateRecipe(body);
  if (!result.ok) throw new PatternStoreError("The recipe isn't valid.", 422, result.errors);
  if (result.recipe.name !== name) throw new PatternStoreError("The recipe's name doesn't match its file.", 422);
  if (expected !== undefined) await checkExpected(dir, name, replaces, expected);

  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `${name}.json`);
  // Write beside the target, then rename over it, so a crash never leaves half a file.
  const temporary = path.join(dir, `.${name}.json.tmp`);
  const text = recipeToJson(result.recipe);
  await writeFile(temporary, text, "utf8");
  await rename(temporary, target);

  if (replaces !== undefined && replaces !== name) {
    await rm(path.join(dir, `${replaces}.json`), { force: true });
  }
  return { recipe: result.recipe, version: fileVersion(text) };
}

export async function deletePattern(dir: string, name: string): Promise<void> {
  checkName(name);
  await rm(path.join(dir, `${name}.json`), { force: true });
}

// Fails if the files on disk aren't what the caller expects. See savePattern.
async function checkExpected(dir: string, name: string, replaces: string | undefined, expected: string | null): Promise<void> {
  const source = replaces ?? name;
  const moving = source !== name;
  if ((expected === null || moving) && (await readVersion(dir, name)) !== null) {
    throw new PatternStoreError(`${name}.json already exists.`, 409);
  }
  if (expected === null) return;
  const current = await readVersion(dir, source);
  if (current === null) throw new PatternStoreError(`${source}.json was deleted after this draft started.`, 409);
  if (current !== expected) throw new PatternStoreError(`${source}.json changed after this draft started.`, 409);
}

// The file's version, or null if there's no such file.
async function readVersion(dir: string, name: string): Promise<string | null> {
  try {
    return fileVersion(await readFile(path.join(dir, `${name}.json`), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function fileVersion(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function checkName(name: string): void {
  const problem = nameProblem(name);
  if (problem) throw new PatternStoreError(problem, 400);
}
