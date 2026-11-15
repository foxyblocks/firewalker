/**
 * Serves the pattern catalog from the dev server while running the phone build in Chrome
 * (`bun run dev:native`), built live from the repo's patterns/ folder. Chrome can't download the
 * CDN's copy, because the CDN sends no CORS headers (transport/catalogFetch.ts), so this gives the
 * phone build's pattern sync something to sync against pretend boots. Only the dev server uses it;
 * the phone build itself ships no catalog and always downloads main's from the CDN.
 */
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { buildCatalog, catalogJson } from "../../designer/server/catalog.ts";

export function devCatalog(): Plugin {
  const patternsDir = process.env.PATTERNS_DIR ?? fileURLToPath(new URL("../../patterns", import.meta.url));
  return {
    name: "firewalker-dev-catalog",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/catalog.json", (_request, response) => {
        buildCatalog(patternsDir, "dev").then(
          (catalog) => {
            response.setHeader("content-type", "application/json");
            response.end(catalogJson(catalog));
          },
          (error: Error) => {
            response.statusCode = 500;
            response.end(error.message);
          },
        );
      });
    },
  };
}
