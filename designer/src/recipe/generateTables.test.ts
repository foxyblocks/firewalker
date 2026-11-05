import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { recipeTablesHeader } from "./generateTables";

describe("recipe tables header", () => {
  const header = recipeTablesHeader();

  it("matches the checked-in file (bun run build-recipes rewrites it)", () => {
    const checkedIn = readFileSync(new URL("../../../include/generated/recipe_tables.h", import.meta.url), "utf8");
    expect(checkedIn).toBe(header);
  });

  it("puts every layer's blend and opacity in slot 0", () => {
    const rows = header.split("\n");
    for (const row of rows.filter((line) => line.endsWith("// blend") || line.endsWith("// opacity"))) {
      expect(row).toMatch(/RecipeFieldKind::(Choice|Knob), 0,/);
    }
  });

  it("gives a layer's other fields their own slots, starting after blend and opacity", () => {
    expect(header).toContain("constexpr uint8_t FillRepeat = 1;");
    expect(header).toContain("constexpr uint8_t TrailTrigger = 1;");
    expect(header).toContain("constexpr uint8_t TrailFrom = 2;");
    expect(header).toContain("constexpr uint8_t TrailFlatZone = 0;");
    expect(header).toContain("constexpr uint8_t TrailMaxFronts = 2;");
  });

  it("carries the reserved names and the size limit", () => {
    expect(header).toContain('{"off", "flow", "fire-trail"}');
    expect(header).toContain("RECIPE_MAX_BYTES = 254");
  });

  it("writes negative and fractional ranges as float literals", () => {
    expect(header).toContain("-400.0f, 400.0f},  // speed");
    expect(header).toContain("0.1f, 8.0f},  // repeat");
  });
});
