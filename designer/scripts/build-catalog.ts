// Writes the pattern catalog the iPhone app syncs to boots: `bun run build-catalog <out-file>`.
// The Publish pattern catalog workflow runs this on every push to main and uploads the result to
// cdn.foxyblocks.com. With no file, it prints the catalog instead. It fails, writing nothing, if
// any recipe in patterns/ can't be compiled.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildCatalog, catalogJson } from "../server/catalog.ts";

const PATTERNS_DIR = fileURLToPath(new URL("../../patterns", import.meta.url));

// GitHub Actions names the commit it checked out. Locally, ask git.
function currentCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const out = process.argv[2];
const text = catalogJson(await buildCatalog(PATTERNS_DIR, currentCommit()));
if (out) {
  writeFileSync(out, text, "utf8");
  console.log(`Wrote ${out}`);
} else {
  process.stdout.write(text);
}
