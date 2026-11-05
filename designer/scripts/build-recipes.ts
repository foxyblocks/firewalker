// Writes the recipe files the firmware builds from. Run it with `bun run build-recipes` after
// changing the recipe format in src/recipe/. Firmware builds use the checked-in result, so they
// don't need Bun.

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { recipeTablesHeader } from "../src/recipe/generateTables.ts";

const OUT_DIR = fileURLToPath(new URL("../../include/generated/", import.meta.url));

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}recipe_tables.h`, recipeTablesHeader());
console.log("Wrote include/generated/recipe_tables.h");
