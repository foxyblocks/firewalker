/**
 * Desktop-only Vite plugins. Local development keeps the designer's file and USB
 * troubleshooting endpoints. Production ships a read-only catalog, and the UI
 * saves the user's own recipes in browser storage. No filesystem or process-control
 * endpoint is deployed. The native build does not register any of these plugins.
 */
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { patternsApi } from "../../designer/server/patternsApi.ts";
import { bootPortsApi } from "../../designer/server/bootPortsApi.ts";
import { listPatterns } from "../../designer/server/patternStore.ts";

export function desktopPlugins(): Plugin[] {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const patternsDir = process.env.PATTERNS_DIR ?? fileURLToPath(new URL("../../patterns", import.meta.url));
  const shown = relative(repoRoot, patternsDir);
  const header = process.env.PATTERNS_DIR ? undefined : fileURLToPath(new URL("../../include/generated/recipe_builtins.h", import.meta.url));
  return [
    patternsApi(patternsDir, shown.startsWith("..") ? patternsDir : `${shown}/`, header),
    bootPortsApi(),
    {
      name: "firewalker-pattern-catalog",
      async generateBundle() {
        const patterns = await listPatterns(patternsDir);
        this.emitFile({ type: "asset", fileName: "patterns.json", source: JSON.stringify({ dir: "patterns/", patterns }) });
      },
    },
  ];
}
