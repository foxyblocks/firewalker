import { describe, expect, it } from "vitest";

import { recipeToJson } from "./serialize";
import { LAYER_TYPES, newLayer } from "./spec";
import type { Recipe } from "./types";
import { nameProblem, validateRecipe } from "./validate";

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    format: "firewalker-recipe",
    version: 1,
    name: "lava-pour",
    description: "",
    layers: [newLayer("fill")],
    ...overrides,
  };
}

describe("validateRecipe", () => {
  it("accepts a default layer of every type", () => {
    const result = validateRecipe(recipe({ layers: LAYER_TYPES.map(newLayer).slice(0, 8) }));
    expect(result).toMatchObject({ ok: true });
  });

  it("rejects an unknown layer type and an unknown field", () => {
    const result = validateRecipe(recipe({ layers: [{ type: "laser" } as never, { ...newLayer("fill"), speed: 3 } as never] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('Layer 1 has an unknown type "laser".');
      expect(result.errors).toContain('Layer 2 (fill) has an unknown field "speed".');
    }
  });

  it("checks knob ranges, including a binding's ends", () => {
    const layer = { ...newLayer("fill"), brightness: { source: "tilt", min: 0, max: 2 } };
    const result = validateRecipe(recipe({ layers: [layer as never] }));
    expect(result).toEqual({ ok: false, errors: ["Layer 1 (fill): brightness.max must be from 0 to 1."] });
  });

  it("only allows a period on a wave binding", () => {
    const layer = { ...newLayer("fill"), offset: { source: "tilt", min: 0, max: 1, periodMs: 500 } };
    const result = validateRecipe(recipe({ layers: [layer as never] }));
    expect(result.ok).toBe(false);
  });

  it("rejects bad palettes", () => {
    const upper = validateRecipe(recipe({ layers: [{ ...newLayer("fill"), palette: ["#FF0000"] } as never] }));
    const empty = validateRecipe(recipe({ layers: [{ ...newLayer("fill"), palette: [] } as never] }));
    expect(upper.ok).toBe(false);
    expect(empty.ok).toBe(false);
  });

  it("caps the layer count", () => {
    const result = validateRecipe(recipe({ layers: Array.from({ length: 9 }, () => newLayer("fill")) }));
    expect(result.ok).toBe(false);
  });
});

describe("nameProblem", () => {
  it("allows short lowercase names that fit a 20-byte BLE write", () => {
    expect(nameProblem("fire-trail")).toBeNull();
    expect(nameProblem("abcdefghijkl")).toBeNull();
  });

  it("rejects names that are too long, oddly spelled, or reserved", () => {
    expect(nameProblem("abcdefghijklm")).not.toBeNull();
    expect(nameProblem("Lava")).not.toBeNull();
    expect(nameProblem("../etc")).not.toBeNull();
    expect(nameProblem("9lives")).not.toBeNull();
    expect(nameProblem("off")).not.toBeNull();
  });
});

describe("recipeToJson", () => {
  it("writes fields in file order with a trailing newline", () => {
    const shuffled = { layers: [{ ...newLayer("pool"), label: "gauge" }], description: "d", name: "x", version: 1, format: "firewalker-recipe" };
    const json = recipeToJson(shuffled as Recipe);
    expect(json.endsWith("}\n")).toBe(true);
    expect(Object.keys(JSON.parse(json))).toEqual(["format", "version", "name", "description", "layers"]);
    expect(Object.keys(JSON.parse(json).layers[0])).toEqual(["type", "label", "enabled", "baseline", "blend", "opacity"]);
  });

  it("keeps each palette and binding on one line, and round-trips", () => {
    const source = recipe({ description: 'Says "source": [x] on one line.', layers: [newLayer("fill"), newLayer("trail")] });
    const json = recipeToJson(source);
    expect(json).toContain('"palette": ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"],');
    expect(json).toContain('"brightness": { "source": "stompStrength", "min": 0.3, "max": 1 },');
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(source)));
  });
});
