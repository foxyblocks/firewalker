/**
 * Decides what pattern sync does to one boot, as pure code. patternSync.ts asks the boot what it
 * has (`recipes`, then `recipe info` for each wanted name it holds), hands that here with the
 * wanted recipes and this phone's record of what it put on the boot before, and then carries
 * out the plan one recipe at a time.
 *
 * The rules, which keep main canonical while leaving designer experiments alone:
 *
 * - Upload a wanted recipe when the boot has no upload of that name, or its size or checksum
 *   differs. That resets a designer experiment that reuses a main pattern's name to main's version.
 * - Hold back a recipe whose version the boot's firmware can't read, and report it.
 * - Delete an upload only when this phone put it there (it's in the record) and it's no longer
 *   wanted. An upload this phone never put there is someone's experiment, so it stays.
 * - Deletes go first, so they free slots. A new name takes a free slot; replacing an upload
 *   takes none. When slots run out, upload what fits and report the rest.
 *
 * Built-ins don't answer `recipe info`, so a built-in with a wanted name reads as missing and
 * gets uploaded over. That's how main's version of a built-in reaches boots without a firmware
 * update, at the cost of an upload slot.
 */

import type { PatternOrigin, WantedRecipe } from "./patternLibrary";

/** What a boot reported about its uploads. */
export interface BootRecipes {
  /** The recipe versions its firmware reads, from the `recipes` reply. */
  versions: readonly number[];
  /** Free upload slots, from the `recipes` reply. */
  free: number;
  /**
   * Every upload on the boot, by name. For a name that's wanted, the value is its `recipe info`
   * (size and checksum), or null when that couldn't be read. Other names map to null.
   */
  uploads: Readonly<Record<string, { bytes: number; crc: string } | null>>;
}

/**
 * The uploads this phone has put on one boot, by name, with each one's origin. Pattern sync keeps
 * one per boot in storage (`ON_BOOT_KEY_PREFIX` in patternSync.ts). It's what lets sync tell its own
 * uploads, which it may delete, from designer experiments, which it never touches.
 */
export type OnBootRecord = Record<string, PatternOrigin>;

export interface SyncPlan {
  /** Uploads to delete first, by name. */
  deletes: string[];
  /** Recipes to upload, in order. */
  uploads: WantedRecipe[];
  /** Recipes the boot already has, byte for byte. */
  upToDate: WantedRecipe[];
  /** Recipes held back because the boot's firmware can't read their version. */
  needsFirmware: WantedRecipe[];
  /** Recipes left off because the boot's slots ran out. */
  noRoom: WantedRecipe[];
}

/** Works out what to delete, upload, and skip on one boot. See the module comment for the rules. */
export function planSync(wanted: readonly WantedRecipe[], boot: BootRecipes, record: OnBootRecord): SyncPlan {
  const wantedNames = new Set(wanted.map((recipe) => recipe.name));
  const deletes = Object.keys(record).filter((name) => !wantedNames.has(name) && name in boot.uploads);

  const plan: SyncPlan = { deletes, uploads: [], upToDate: [], needsFirmware: [], noRoom: [] };
  let free = boot.free + deletes.length;
  for (const recipe of wanted) {
    if (!boot.versions.includes(recipe.recipeVersion)) {
      plan.needsFirmware.push(recipe);
      continue;
    }
    const onBoot = boot.uploads[recipe.name];
    if (onBoot && onBoot.crc === recipe.crc && onBoot.bytes === recipe.bytes.length) {
      plan.upToDate.push(recipe);
    } else if (recipe.name in boot.uploads) {
      plan.uploads.push(recipe);
    } else if (free > 0) {
      free--;
      plan.uploads.push(recipe);
    } else {
      plan.noRoom.push(recipe);
    }
  }
  return plan;
}

/**
 * This phone's record for the boot once a sync has run. It holds main's recipes the boot now has
 * (uploaded or already up to date), plus anything recorded before that's still on the boot, such
 * as a delete that failed or an older copy an upload failed to replace, so the next sync can
 * finish the job. Names that left the boot are forgotten.
 */
export function recordAfterSync(
  record: OnBootRecord,
  plan: SyncPlan,
  boot: BootRecipes,
  done: { deleted: readonly string[]; uploaded: readonly string[] },
): OnBootRecord {
  const next: OnBootRecord = {};
  for (const recipe of plan.upToDate) next[recipe.name] = recipe.origin;
  for (const recipe of plan.uploads) {
    if (done.uploaded.includes(recipe.name)) next[recipe.name] = recipe.origin;
  }
  for (const [name, origin] of Object.entries(record)) {
    if (!(name in next) && name in boot.uploads && !done.deleted.includes(name)) next[name] = origin;
  }
  return next;
}
