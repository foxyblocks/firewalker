// Keeps the firmware's built-in recipes in step with patterns/. It reads patterns/built-ins.txt, writes
// include/generated/recipe_builtins.h, and works out the hash that lets a firmware build notice a
// stale header. `bun run build-recipes` uses this, and so does the dev server after a Save or Delete
// that touches a built-in, so a built-in recipe and its header change in the same commit.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { builtinsHeader, parseBuiltInList, renameInBuiltInList } from "../src/recipe/generateBuiltins.ts";
import type { Recipe } from "../src/recipe/types.ts";

export const BUILT_IN_LIST_FILE = "built-ins.txt";

// The list's text, or nothing if this folder has no list, such as a PATTERNS_DIR scratch folder.
async function readListText(dir: string): Promise<string | null> {
  try {
    return await readFile(path.join(dir, BUILT_IN_LIST_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readBuiltInNames(dir: string): Promise<string[]> {
  const text = await readListText(dir);
  return text === null ? [] : parseBuiltInList(text);
}

// The header as it should be right now. Throws with a plain reason if the list names a recipe that
// doesn't exist or can't be built in.
export async function currentBuiltinsHeader(dir: string): Promise<string> {
  const listText = (await readListText(dir)) ?? "";
  const hash = createHash("sha256").update(listText);
  const recipes: Recipe[] = [];
  for (const name of parseBuiltInList(listText)) {
    let text: string;
    try {
      text = await readFile(path.join(dir, `${name}.json`), "utf8");
    } catch {
      throw new Error(`${BUILT_IN_LIST_FILE} lists "${name}", but there's no ${name}.json.`);
    }
    hash.update(text);
    recipes.push(JSON.parse(text) as Recipe);
  }
  return builtinsHeader(recipes, hash.digest("hex"));
}

export async function writeBuiltinsHeader(dir: string, headerPath: string): Promise<void> {
  await writeFile(headerPath, await currentBuiltinsHeader(dir), "utf8");
}

// Updates the list after a recipe is renamed, or removed when `replacement` is null. Returns whether
// the name was on it.
export async function renameBuiltIn(dir: string, name: string, replacement: string | null): Promise<boolean> {
  const text = await readListText(dir);
  if (text === null || !parseBuiltInList(text).includes(name)) return false;
  await writeFile(path.join(dir, BUILT_IN_LIST_FILE), renameInBuiltInList(text, name, replacement), "utf8");
  return true;
}
