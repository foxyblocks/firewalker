/**
 * What both the designer and the iPhone app need to know about a compiled recipe, with no
 * compiler attached. The designer's compiler (designer/src/recipe/compile.ts) writes these
 * bytes. The phone only checks and forwards them: it reads compiled recipes from the pattern
 * catalog and uploads them to boots as they are, so it needs the checksum, the size limit,
 * and the name rule, but never the recipe format itself.
 *
 * A compiled recipe starts with its version byte, then its name's length and the name's
 * characters, and ends with a CRC-32 of everything before it, low byte first:
 *
 *   [version] [name length] [name...] [layers...] [crc0 crc1 crc2 crc3]
 *
 * The firmware's checks in include/firewalker_recipe_upload.h read the same layout. Keep this
 * file free of imports, so the phone's bundle can take it without pulling in the designer.
 */

// NVM3's largest entry, so one recipe saves all at once and a power cut can't leave half of it.
export const MAX_COMPILED_BYTES = 254;
// The boot lists patterns by name and `pattern <name>` has to fit a 20-byte BLE write.
export const MAX_NAME_LENGTH = 12;
// `off` is a remote command value, not a pattern. Every other legal name can be a recipe,
// including the retired names `flow` and `fire-trail`. generateTables.ts carries this rule into
// the firmware decoder, so uploading a tweaked built-in follows the same rules as saving it.
export const RESERVED_NAMES: ReadonlySet<string> = new Set(["off"]);

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
// The version byte, the name length byte, a one-letter name, and the four checksum bytes.
const SMALLEST_RECIPE = 7;

/** Returns a reason the name can't be a pattern's, or null if it's fine. */
export function nameProblem(name: string): string | null {
  if (name.length === 0) return "Name is empty.";
  if (name.length > MAX_NAME_LENGTH) return `Name is longer than ${MAX_NAME_LENGTH} characters.`;
  if (!NAME_PATTERN.test(name)) return "Name must start with a letter and use only a-z, 0-9, and hyphens.";
  if (RESERVED_NAMES.has(name)) return `"${name}" is reserved.`;
  return null;
}

/**
 * CRC-32, the common zlib polynomial. It matches settingsCrc in include/firewalker_settings.h, and
 * its value goes last in the binary and in `recipe info` replies.
 */
export function recipeCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * The checksum a boot reports for these compiled bytes in a `recipe info` reply: the CRC of
 * everything but the last four bytes, as eight lowercase hex digits, such as "cb75d224".
 */
export function compiledCrc(bytes: Uint8Array): string {
  return recipeCrc(bytes.subarray(0, Math.max(0, bytes.length - 4))).toString(16).padStart(8, "0");
}

export type CompiledCheck =
  | { ok: true; version: number; name: string; crc: string }
  | { ok: false; error: "bad-checksum" | "bad-recipe"; reason: string };

/**
 * Checks the parts of a compiled recipe that don't need the compiler: its size, its stored
 * checksum, and the name in its header. A recipe that passes is intact and named legally; whether
 * a boot can read its layers is the boot's call. The error codes are the firmware's, so a pretend
 * boot can answer with them.
 */
export function checkCompiledRecipe(bytes: Uint8Array): CompiledCheck {
  if (bytes.length > MAX_COMPILED_BYTES) return { ok: false, error: "bad-recipe", reason: `A recipe is at most ${MAX_COMPILED_BYTES} bytes.` };
  if (bytes.length < SMALLEST_RECIPE) return { ok: false, error: "bad-recipe", reason: "The recipe ends too soon." };
  const end = bytes.length - 4;
  const stored = (bytes[end]! | (bytes[end + 1]! << 8) | (bytes[end + 2]! << 16) | (bytes[end + 3]! << 24)) >>> 0;
  if (stored !== recipeCrc(bytes.subarray(0, end))) return { ok: false, error: "bad-checksum", reason: "The checksum doesn't match." };

  const nameLength = bytes[1]!;
  if (nameLength === 0 || 2 + nameLength > end) return { ok: false, error: "bad-recipe", reason: "The name is the wrong length." };
  const name = String.fromCharCode(...bytes.subarray(2, 2 + nameLength));
  const problem = nameProblem(name);
  if (problem) return { ok: false, error: "bad-recipe", reason: problem };
  return { ok: true, version: bytes[0]!, name, crc: stored.toString(16).padStart(8, "0") };
}
