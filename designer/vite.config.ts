import { relative } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Explicit .ts extensions here and in server/: Vite loads this config through Node, which
// resolves TypeScript imports only by their full file name.
import { patternsApi } from "./server/patternsApi.ts";

// Recipes live in the repo's patterns/ folder, next to this one. PATTERNS_DIR points the
// designer somewhere else, for example a scratch folder while trying things out.
const patternsDir = process.env.PATTERNS_DIR ?? fileURLToPath(new URL("../patterns", import.meta.url));
// What the designer shows as the save location: repo-relative when it's inside the repo.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const shownDir = relative(repoRoot, patternsDir).startsWith("..") ? patternsDir : `${relative(repoRoot, patternsDir)}/`;
// Saving a built-in recipe updates the firmware's copy, unless this is a scratch folder.
const builtinsHeader = process.env.PATTERNS_DIR ? undefined : fileURLToPath(new URL("../include/generated/recipe_builtins.h", import.meta.url));

// Port 5174, so the designer and the iPhone app's dev server (5173) can run side by side.
export default defineConfig({
  plugins: [react(), patternsApi(patternsDir, shownDir, builtinsHeader)],
  // Send to boot reuses the iPhone app's connection code from ../app.
  server: { host: "localhost", port: 5174, fs: { allow: [".."] } },
  test: { environment: "node", globals: true },
});
