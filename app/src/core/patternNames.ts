/**
 * Friendly names for patterns. The boot decides which patterns exist and reports their
 * IDs, so a pattern added in firmware works with no app update: it gets a generated
 * name until someone adds a nicer one here.
 */

export interface PatternDisplay {
  name: string;
  description?: string;
}

const KNOWN_PATTERNS: Record<string, PatternDisplay> = {
  flow: { name: "Flow", description: "Tilt pools color" },
  "fire-trail": { name: "Fire-trail", description: "Stomps launch fire" },
};

/** A display name for a pattern ID, such as "pattern-4" becoming "Pattern 4". */
export function patternDisplay(id: string): PatternDisplay {
  const known = KNOWN_PATTERNS[id];
  if (known) return known;
  const words = id.replace(/[-_]+/g, " ").trim();
  return { name: words.charAt(0).toUpperCase() + words.slice(1) };
}
