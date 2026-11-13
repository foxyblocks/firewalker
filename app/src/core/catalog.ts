/**
 * Reads the pattern catalog: main's recipes, compiled, as published on the CDN (format in
 * shared/patternCatalog.ts). `PatternLibrary` (patternLibrary.ts) fetches and caches the file and
 * calls `parseCatalog` on it; pattern sync then uploads the compiled bytes to boots as they are.
 *
 * The phone has no compiler, so it can't check a recipe's layers. It checks everything else
 * strictly: each entry's bytes must pass their own checksum, match their stated size, version,
 * and checksum, and carry the entry's name in their header. One bad entry rejects the whole
 * catalog, and the phone keeps the copy it had, so a damaged download can never put a broken
 * recipe on a boot or quietly drop a pattern.
 */

import { CATALOG_FORMAT, CATALOG_VERSION } from "../../../shared/patternCatalog";
import { checkCompiledRecipe, nameProblem } from "../../../shared/recipeBinary";
import type { LibraryPattern } from "./patternLibrary";

export interface Catalog {
  /** The git commit on main the catalog was built from. */
  commit: string;
  /** Main's patterns, sorted by name, each with origin "canonical". */
  patterns: LibraryPattern[];
}

export type CatalogParse = { ok: true; catalog: Catalog } | { ok: false; error: string };

const HEX = /^(?:[0-9a-f]{2})+$/;
const CRC = /^[0-9a-f]{8}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Parses and checks a downloaded catalog. Never throws; a bad file comes back as an error. */
export function parseCatalog(text: string): CatalogParse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "The catalog isn't JSON." };
  }
  if (!isObject(value) || value.format !== CATALOG_FORMAT) return { ok: false, error: "This isn't a pattern catalog." };
  if (value.version !== CATALOG_VERSION) return { ok: false, error: `This app reads catalog version ${CATALOG_VERSION}, not ${String(value.version)}.` };
  if (typeof value.commit !== "string") return { ok: false, error: "The catalog doesn't say which commit it's from." };
  if (!Array.isArray(value.patterns)) return { ok: false, error: "The catalog has no pattern list." };

  const patterns: LibraryPattern[] = [];
  const names = new Set<string>();
  for (const [index, entry] of value.patterns.entries()) {
    const parsed = parseEntry(entry);
    if (typeof parsed === "string") {
      const label = isObject(entry) && typeof entry.name === "string" ? entry.name : `#${index + 1}`;
      return { ok: false, error: `Pattern ${label} in the catalog is wrong: ${parsed}` };
    }
    if (names.has(parsed.name)) return { ok: false, error: `The catalog has two patterns named ${parsed.name}.` };
    names.add(parsed.name);
    patterns.push(parsed);
  }
  return { ok: true, catalog: { commit: value.commit, patterns } };
}

/** One entry as a library pattern, or the reason it's wrong. */
function parseEntry(entry: unknown): LibraryPattern | string {
  if (!isObject(entry)) return "it isn't an object.";
  const { name, description, recipeVersion, bytes, crc, data, recipe } = entry;
  if (typeof name !== "string") return "it has no name.";
  const problem = nameProblem(name);
  if (problem) return problem;
  if (typeof description !== "string") return "it has no description.";
  if (typeof data !== "string" || !HEX.test(data)) return "its data isn't hex.";
  if (typeof crc !== "string" || !CRC.test(crc)) return "its crc isn't eight hex digits.";
  if (!isObject(recipe)) return "it has no source recipe.";

  const compiled = Uint8Array.from(data.match(/../g)!, (pair) => parseInt(pair, 16));
  if (bytes !== compiled.length) return `it says ${String(bytes)} bytes but holds ${compiled.length}.`;
  const check = checkCompiledRecipe(compiled);
  if (!check.ok) return check.reason;
  if (check.crc !== crc) return "its crc doesn't match its bytes.";
  if (check.name !== name) return `its bytes are named ${check.name}.`;
  if (check.version !== recipeVersion) return `its bytes are recipe version ${check.version}, not ${String(recipeVersion)}.`;

  return { name, description, origin: "canonical", recipeVersion: check.version, bytes: compiled, crc, recipe };
}

/**
 * Identifies a catalog's contents: each pattern's name and checksum. Two catalogs with the same
 * fingerprint put exactly the same bytes on a boot, so a new commit that changed no pattern
 * doesn't make pattern sync run again.
 */
export function catalogFingerprint(catalog: Catalog): string {
  return catalog.patterns.map((pattern) => `${pattern.name}:${pattern.crc}`).join(",");
}
