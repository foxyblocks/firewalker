import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileRecipe, decodeRecipe, LAYER_CODES, MAX_COMPILED_BYTES, recipeCrc } from "./compile";
import { fieldsFor, LAYER_TYPES, newLayer, WAVE_PERIOD } from "./spec";
import { isBinding, RECIPE_VERSION, type Layer, type Recipe } from "./types";
import { validateRecipe } from "./validate";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

function readRecipes(folder: string): Recipe[] {
  const dir = path.join(REPO, folder);
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Recipe);
}

const KEPT = readRecipes("patterns");
const TEST_RECIPES = readRecipes("test/fixtures/recipe-frames/recipes");

function recipe(name: string, ...layers: Layer[]): Recipe {
  return { format: "firewalker-recipe", version: 1, name, description: "", layers };
}

function compiled(source: Recipe): Uint8Array {
  const result = compileRecipe(source);
  if (!result.ok) throw new Error(result.errors.join(" "));
  return result.bytes;
}

// The bytes with a good checksum on the end, for testing what's inside them.
function withCrc(body: number[]): Uint8Array {
  const crc = recipeCrc(Uint8Array.from(body));
  return Uint8Array.from([...body, crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24]);
}

// Bytes for "ab" with one layer of the given bytes.
const oneLayer = (...layer: number[]) => withCrc([RECIPE_VERSION, 2, 97, 98, 1, ...layer]);

describe("compileRecipe", () => {
  it("uses version 2 for Band or audio, and keeps older effects on version 1", () => {
    const audioFill = { ...newLayer("fill"), brightness: { source: "audioLevel", min: 0, max: 1 } } as Layer;
    expect(compiled(recipe("ab", newLayer("fill")))[0]).toBe(1);
    expect(compiled(recipe("ab", newLayer("band")))[0]).toBe(2);
    expect(compiled(recipe("ab", audioFill))[0]).toBe(2);
    expect(compiled(recipe("ab", newLayer("fill"), { ...audioFill, enabled: false }))[0]).toBe(1);
  });
  it("lays out a recipe's start as the spec says", () => {
    const comet = KEPT.find((r) => r.name === "comet")!;
    const hex = Buffer.from(compiled(comet)).toString("hex");
    // Version 1, a 5-letter name, "comet", 3 layers, then a fill with no bindings and 2 colors.
    expect(hex.startsWith("0105636f6d6574030000027a00ffff")).toBe(true);
  });

  it("compiles every recipe to the small size the format promises", () => {
    expect(Object.fromEntries(KEPT.map((r) => [r.name, compiled(r).length]))).toMatchObject({
      comet: 74,
      "fire-stomp": 50,
      "lava-pour": 68,
      "rainbow-pool": 103,
      starfield: 83,
    });
  });

  it("marks bound knobs in the mask, in field order", () => {
    const fill: Layer = { ...newLayer("fill"), palette: ["#ffffff"], scroll: { source: "tilt", min: -1, max: 1 } } as Layer;
    const bytes = compiled(recipe("ab", fill));
    // Knobs are repeat, offset, scroll, brightness, opacity, so scroll is bit 2.
    expect(bytes[5]).toBe(LAYER_CODES.indexOf("fill"));
    expect(bytes[6]).toBe(0b00100);
  });

  it("drops the description, labels, and disabled layers", () => {
    const plain = recipe("ab", newLayer("pool"));
    const dressed = { ...plain, description: "Words for people." };
    dressed.layers = [{ ...newLayer("pool"), label: "Gauge" }, { ...newLayer("fill"), enabled: false }];
    expect(compiled(dressed)).toEqual(compiled(plain));
  });

  it("refuses a recipe with no layer turned on", () => {
    const result = compileRecipe(recipe("ab", { ...newLayer("fill"), enabled: false }));
    expect(result).toMatchObject({ ok: false, size: null });
    if (!result.ok) expect(result.errors[0]).toMatch(/at least one layer/);
  });

  it("refuses an invalid recipe, using the validator's words", () => {
    expect(compileRecipe(recipe("off", newLayer("fill")))).toMatchObject({ ok: false, errors: ['"off" is reserved.'] });
  });

  it("refuses a recipe over the limit, saying how far over, and still reports its size", () => {
    const palette = Array.from({ length: 16 }, () => "#102030");
    const layers = Array.from({ length: 8 }, () => ({ ...newLayer("fill"), palette }) as Layer);
    const result = compileRecipe(recipe("ab", ...layers));
    expect(result.ok).toBe(false);
    expect(result.size).toBeGreaterThan(MAX_COMPILED_BYTES);
    if (!result.ok) expect(result.errors[0]).toContain(`${result.size! - MAX_COMPILED_BYTES} over`);
  });

  it("accepts a recipe of exactly the limit", () => {
    // 8 layers, 4 colors each, with one binding each and a 12-letter name.
    const palette = ["#102030", "#102030", "#102030", "#102030"];
    const binding = (min: number, max: number) => ({ source: "wave" as const, min, max, periodMs: 2000 });
    const layers: Layer[] = [
      { ...newLayer("fill"), palette, repeat: binding(0.1, 8) },
      { ...newLayer("fill"), palette, repeat: binding(0.1, 8) },
      { ...newLayer("sparkle"), palette, density: binding(0, 200) },
      { ...newLayer("trail"), palette, speed: binding(1, 400), brightness: 1 },
      { ...newLayer("trail"), palette, speed: binding(1, 400), brightness: 1 },
      { ...newLayer("flash"), palette, brightness: binding(0, 1) },
      { ...newLayer("chase"), palette, speed: binding(-400, 400) },
      { ...newLayer("pool"), baseline: binding(0, 1) },
    ] as Layer[];
    const result = compileRecipe(recipe("abcdefghijkl", ...layers));
    expect(result).toMatchObject({ ok: true, size: MAX_COMPILED_BYTES });
  });
});

describe("decodeRecipe", () => {
  it("refuses Band or audio bytes mislabeled as version 1", () => {
    const audioFill = { ...newLayer("fill"), brightness: { source: "audioLevel", min: 0, max: 1 } } as Layer;
    for (const layer of [newLayer("band"), audioFill]) {
      const body = Array.from(compiled(recipe("ab", layer)).slice(0, -4));
      body[0] = 1;
      expect(decodeRecipe(withCrc(body))).toMatchObject({ ok: false, error: expect.stringContaining("version 1") });
    }
  });
  it.each([...KEPT, ...TEST_RECIPES].map((r) => [r.name, r] as const))("reads %s back to nearly the same recipe", (_, source) => {
    const result = decodeRecipe(compiled(source));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateRecipe(result.recipe)).toMatchObject({ ok: true });
    expect(result.recipe.name).toBe(source.name);

    const enabled = source.layers.filter((layer) => layer.enabled);
    expect(result.recipe.layers.map((layer) => layer.type)).toEqual(enabled.map((layer) => layer.type));
    enabled.forEach((layer, i) => {
      const before = layer as unknown as Record<string, unknown>;
      const after = result.recipe.layers[i] as unknown as Record<string, unknown>;
      for (const field of fieldsFor(layer.type)) {
        if (field.kind === "enum" || field.kind === "palette") {
          expect(after[field.key]).toEqual(before[field.key]);
        } else if (field.kind === "number") {
          expect(after[field.key] as number).toBeCloseTo(before[field.key] as number, 3);
        } else {
          const expected = before[field.key];
          const got = after[field.key];
          // Far closer than 8-bit color can show.
          const tolerance = Math.max(Math.abs(field.min), Math.abs(field.max)) / 30000;
          if (isBinding(expected as never)) {
            const [a, b] = [expected as Record<string, number>, got as Record<string, number>];
            expect(b.source).toBe(a.source);
            expect(Math.abs(b.min! - a.min!)).toBeLessThan(tolerance);
            expect(Math.abs(b.max! - a.max!)).toBeLessThan(tolerance);
            if (a.periodMs) expect(b.periodMs).toBe(a.periodMs);
            if (a.fadeMs) expect(b.fadeMs).toBe(a.fadeMs);
          } else {
            expect(Math.abs((got as number) - (expected as number))).toBeLessThan(tolerance);
          }
        }
      }
    });
  });

  it("compiles what it decoded to the same bytes", () => {
    for (const source of [...KEPT, ...TEST_RECIPES]) {
      const bytes = compiled(source);
      const decoded = decodeRecipe(bytes);
      if (!decoded.ok) throw new Error(decoded.error);
      expect(compiled(decoded.recipe)).toEqual(bytes);
    }
  });

  it("fills in a binding's default period when the file left it out", () => {
    const fill = { ...newLayer("fill"), palette: ["#ffffff"], scroll: { source: "wave", min: 0, max: 1 } } as Layer;
    const decoded = decodeRecipe(compiled(recipe("ab", fill)));
    expect(decoded).toMatchObject({ ok: true, recipe: { layers: [{ scroll: { periodMs: WAVE_PERIOD.default } }] } });
  });

  it("covers every layer type, so a new one has to get a code", () => {
    expect([...LAYER_CODES].sort()).toEqual([...LAYER_TYPES].sort());
  });

  describe("refuses", () => {
    const good = compiled(recipe("ab", newLayer("pool")));
    const refused = (bytes: Uint8Array) => {
      const result = decodeRecipe(bytes);
      return result.ok ? "accepted" : result.error;
    };

    it("a damaged byte", () => {
      const bad = good.slice();
      bad[6] = bad[6]! ^ 1;
      expect(refused(bad)).toMatch(/checksum/);
    });

    it("a recipe cut short, at every length", () => {
      for (let length = 0; length < good.length; length++) expect(refused(good.slice(0, length))).not.toBe("accepted");
    });

    it("a recipe too long to store", () => {
      expect(refused(new Uint8Array(MAX_COMPILED_BYTES + 1))).toMatch(/at most/);
    });

    it("another version", () => {
      const body = Array.from(good.slice(0, -4));
      body[0] = RECIPE_VERSION + 1;
      expect(refused(withCrc(body))).toMatch(/Version/);
    });

    it("a bad or reserved name", () => {
      expect(refused(withCrc([RECIPE_VERSION, 0, 1, 1, 0]))).toMatch(/name/i);
      expect(refused(withCrc([RECIPE_VERSION, 13, ...new Array(13).fill(97), 1]))).toMatch(/name/i);
      expect(refused(withCrc([RECIPE_VERSION, 2, 65, 66, 1]))).toMatch(/Name/);
      expect(refused(withCrc([RECIPE_VERSION, 3, 111, 102, 102, 1]))).toMatch(/reserved/);
    });

    it("no layers, or too many", () => {
      expect(refused(withCrc([RECIPE_VERSION, 2, 97, 98, 0]))).toMatch(/layers/);
      expect(refused(withCrc([RECIPE_VERSION, 2, 97, 98, 9]))).toMatch(/layers/);
    });

    it("an unknown layer type, option, or source", () => {
      expect(refused(oneLayer(LAYER_CODES.length, 0))).toMatch(/type/);
      // A pool's knobs are baseline and opacity. Its blend is the choice between them.
      expect(refused(oneLayer(LAYER_CODES.indexOf("pool"), 0, 0, 0, 200, 0, 0))).toMatch(/option/);
      expect(refused(oneLayer(LAYER_CODES.indexOf("pool"), 1, 200, 0, 0, 0, 0))).toMatch(/source/);
    });

    it("a palette of no colors, or too many", () => {
      expect(refused(oneLayer(LAYER_CODES.indexOf("fill"), 0, 0))).toMatch(/palette/);
      expect(refused(oneLayer(LAYER_CODES.indexOf("fill"), 0, 17))).toMatch(/palette/);
    });

    it("extra bytes after the last layer", () => {
      const body = Array.from(good.slice(0, -4));
      expect(refused(withCrc([...body, 0]))).toMatch(/extra/);
    });
  });

  it("limits a number to its field's range", () => {
    // A pool's baseline runs from 0 to 1, so a raw -32767 would read as -1.
    const decoded = decodeRecipe(oneLayer(LAYER_CODES.indexOf("pool"), 0, 0x01, 0x80, 0, 0xff, 0x7f));
    expect(decoded).toMatchObject({ ok: true, recipe: { layers: [{ baseline: 0, opacity: 1 }] } });
  });
});
