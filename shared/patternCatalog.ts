/**
 * The pattern catalog's file format: every recipe on main, compiled, in one JSON file. The
 * designer writes it (designer/server/catalog.ts, run by `bun run build-catalog` and the
 * Publish pattern catalog workflow), and the iPhone app reads it (app/src/core/catalog.ts) to
 * keep boots in step with main. docs/adr/0007-sync-patterns-from-main.md has the why.
 *
 *   {
 *     "format": "firewalker-catalog",
 *     "version": 1,
 *     "commit": "<the git commit it was built from>",
 *     "patterns": [
 *       { "name": "comet", "description": "...", "recipeVersion": 1, "bytes": 74,
 *         "crc": "cb75d224", "data": "<compiled bytes as hex>", "recipe": { ...patterns/comet.json } }
 *     ]
 *   }
 *
 * `data` is what a boot stores, and the phone sends it as is, so the phone never needs the
 * compiler. `crc` is the checksum a boot reports for it in `recipe info`. `recipe` is the source
 * recipe exactly as in patterns/<name>.json, for features that show or edit a pattern's layers.
 * A reader that finds a higher `version` than it knows must ignore the file, so a format change
 * bumps it.
 */

export const CATALOG_FORMAT = "firewalker-catalog";
export const CATALOG_VERSION = 1;

export interface CatalogEntryJson {
  name: string;
  description: string;
  /** The recipe format version the compiled bytes need, which is also their first byte. */
  recipeVersion: number;
  /** How many compiled bytes `data` holds. */
  bytes: number;
  /** The checksum of the compiled bytes, as eight hex digits. */
  crc: string;
  /** The compiled bytes, as lowercase hex. */
  data: string;
  /** The source recipe, as in patterns/<name>.json. */
  recipe: unknown;
}

export interface CatalogJson {
  format: typeof CATALOG_FORMAT;
  version: typeof CATALOG_VERSION;
  commit: string;
  patterns: CatalogEntryJson[];
}
