// Builds the pattern catalog: every recipe in patterns/, compiled, in one JSON file that the iPhone
// app downloads and syncs to boots (format in shared/patternCatalog.ts). `bun run build-catalog`
// writes it, and the Publish pattern catalog workflow puts it on the CDN after every push to main.
//
// The output only depends on the folder and the commit, so the same main always gives the same
// file: entries are sorted by name and nothing records when it was built. Any recipe that can't be
// read or compiled stops the build, so a catalog never goes out with a pattern quietly missing.

import { listPatterns } from "./patternStore.ts";
import { compileRecipe } from "../src/recipe/compile.ts";
import { CATALOG_FORMAT, CATALOG_VERSION, type CatalogJson } from "../../shared/patternCatalog.ts";
import { compiledCrc } from "../../shared/recipeBinary.ts";

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Reads and compiles every recipe in `dir`. `commit` names the git commit the folder came from, so
 * someone looking at a published catalog can tell which main it is. Throws with every broken
 * recipe's name and reason.
 */
export async function buildCatalog(dir: string, commit: string): Promise<CatalogJson> {
  const problems: string[] = [];
  const patterns: CatalogJson["patterns"] = [];
  for (const pattern of await listPatterns(dir)) {
    if (!pattern.recipe) {
      problems.push(`${pattern.name}: ${(pattern.errors ?? ["can't be read"]).join(" ")}`);
      continue;
    }
    const compiled = compileRecipe(pattern.recipe);
    if (!compiled.ok) {
      problems.push(`${pattern.name}: ${compiled.errors.join(" ")}`);
      continue;
    }
    patterns.push({
      name: pattern.name,
      description: pattern.recipe.description,
      recipeVersion: compiled.bytes[0]!,
      bytes: compiled.bytes.length,
      crc: compiledCrc(compiled.bytes),
      data: hex(compiled.bytes),
      // listPatterns hands back the file's parsed JSON as is, so this is the recipe exactly as kept.
      recipe: pattern.recipe,
    });
  }
  if (problems.length > 0) throw new Error(`These patterns can't go in the catalog:\n${problems.join("\n")}`);
  return { format: CATALOG_FORMAT, version: CATALOG_VERSION, commit, patterns };
}

/** The catalog as the file the CDN serves. */
export function catalogJson(catalog: CatalogJson): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}
