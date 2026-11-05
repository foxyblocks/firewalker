// Keeps test/fixtures/recipe-frames/ honest, and writes it when asked: `bun run reference-frames`
// runs this file with UPDATE_REFERENCE_FRAMES set. Writing from here means the files always come
// from the same JavaScript runtime that checks them.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildReferenceFiles, CHECK_EVERY, referenceCases, referenceInputs, REFERENCE_FRAMES, renderCase } from "./referenceFrames";
import { BOOT_3EB5 } from "./strip";
import { recipeToJson } from "../recipe/serialize";
import { fieldsFor, LAYER_TYPES } from "../recipe/spec";
import { BLENDS, isBinding, SOURCES, type Recipe } from "../recipe/types";
import { validateRecipe } from "../recipe/validate";

const FIXTURE_DIR = fileURLToPath(new URL("../../../test/fixtures/recipe-frames", import.meta.url));
const RECIPE_DIR = path.join(FIXTURE_DIR, "recipes");

const RECIPES: Recipe[] = readdirSync(RECIPE_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => JSON.parse(readFileSync(path.join(RECIPE_DIR, file), "utf8")) as Recipe);

// The test recipes and the folder's documentation are edited by hand. Everything else is generated.
const isHandWritten = (file: string) => file === "README.md" || file.startsWith("recipes/");

function filesOnDisk(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesOnDisk(path.join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );
}

function writeFiles(files: Map<string, Uint8Array>): void {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const file of filesOnDisk(FIXTURE_DIR)) {
    if (!files.has(file) && !isHandWritten(file)) rmSync(path.join(FIXTURE_DIR, file));
  }
  for (const [file, bytes] of files) writeFileSync(path.join(FIXTURE_DIR, file), bytes);
}

describe("reference frames", () => {
  it("match the files in test/fixtures/recipe-frames (bun run reference-frames rewrites them)", () => {
    const files = buildReferenceFiles(RECIPES);
    if (process.env.UPDATE_REFERENCE_FRAMES === "1") writeFiles(files);

    const generated = new Set(files.keys());
    const onDisk = filesOnDisk(FIXTURE_DIR).filter((file) => !isHandWritten(file));
    const stale = [...generated].filter((file) => {
      const current = onDisk.includes(file) ? readFileSync(path.join(FIXTURE_DIR, file)) : null;
      return !current || !current.equals(files.get(file)!);
    });
    const extra = onDisk.filter((file) => !generated.has(file));
    expect({ stale, extra }).toEqual({ stale: [], extra: [] });
  });

  it("come out the same every run", () => {
    const [testCase] = referenceCases(RECIPES);
    const inputs = referenceInputs();
    expect(renderCase(testCase!.recipe, testCase!.layout, inputs)).toEqual(renderCase(testCase!.recipe, testCase!.layout, inputs));
  });

  it("save one frame per check, and each file's header says so", () => {
    const files = buildReferenceFiles(RECIPES);
    const checkpoints = Math.floor(REFERENCE_FRAMES / CHECK_EVERY);
    for (const testCase of referenceCases(RECIPES)) {
      const bytes = files.get(testCase.file)!;
      const view = new DataView(bytes.buffer);
      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("FWRF");
      expect(view.getUint16(6, true)).toBe(testCase.layout.count);
      expect(view.getUint16(8, true)).toBe(testCase.layout.toe);
      expect(view.getUint16(10, true)).toBe(testCase.layout.heel);
      expect(view.getUint16(12, true)).toBe(CHECK_EVERY);
      expect(view.getUint16(14, true)).toBe(checkpoints);
      expect(bytes.length).toBe(16 + checkpoints * testCase.layout.count * 3);
    }
  });

  it("save inputs a C++ test reads back exactly", () => {
    const inputs = referenceInputs();
    const bytes = buildReferenceFiles(RECIPES).get("inputs.bin")!;
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("FWRI");
    expect(view.getUint16(6, true)).toBe(REFERENCE_FRAMES);
    inputs.forEach((input, i) => {
      const at = 8 + i * 12;
      expect(view.getFloat32(at, true)).toBe(input.tiltFwd);
      expect(view.getFloat32(at + 4, true)).toBe(input.stompStrength);
      expect(view.getUint16(at + 8, true)).toBe(input.dt);
      expect(view.getUint8(at + 10)).toBe(input.stomp ? 1 : 0);
    });
  });

  it("have a script that stomps flat, toe down, and heel down, with uneven frame times", () => {
    const inputs = referenceInputs();
    const stomps = inputs.filter((input) => input.stomp);
    expect(stomps.some((input) => input.tiltFwd === 0)).toBe(true);
    expect(stomps.some((input) => input.tiltFwd > 0.5)).toBe(true);
    expect(stomps.some((input) => input.tiltFwd < -0.5)).toBe(true);
    expect(new Set(inputs.map((input) => input.dt)).size).toBeGreaterThan(1);
    expect(Math.max(...inputs.map((input) => input.tiltFwd))).toBeGreaterThan(0.95);
    expect(Math.min(...inputs.map((input) => input.tiltFwd))).toBeLessThan(-0.95);
  });

  it.each(RECIPES.map((recipe) => [recipe.name, recipe] as const))("test recipe %s is a valid recipe that draws something that moves", (name, recipe) => {
    expect(validateRecipe(recipe)).toMatchObject({ ok: true });
    expect(readFileSync(path.join(RECIPE_DIR, `${name}.json`), "utf8")).toBe(recipeToJson(recipe));
    const frames = renderCase(recipe, BOOT_3EB5, referenceInputs());
    const size = BOOT_3EB5.count * 3;
    expect(frames.some((value) => value > 0)).toBe(true);
    const first = frames.slice(0, size).join();
    const anyDifferent = Array.from({ length: frames.length / size }, (_, i) => frames.slice(i * size, (i + 1) * size).join()).some((frame) => frame !== first);
    expect(anyDifferent).toBe(true);
  });

  // A new layer type, blend, choice, or source has to get a case, or the C++ engine could get it
  // wrong with nothing to catch it.
  it("cover every layer type, blend, choice, and knob source", () => {
    const layers = RECIPES.flatMap((recipe) => recipe.layers) as unknown as (Record<string, unknown> & { type: (typeof LAYER_TYPES)[number] })[];

    expect(new Set(layers.map((layer) => layer.type))).toEqual(new Set(LAYER_TYPES));
    expect(new Set(layers.map((layer) => layer.blend))).toEqual(new Set(BLENDS));

    const sources = new Set<string>();
    for (const layer of layers) {
      for (const value of Object.values(layer)) {
        if (typeof value === "object" && value !== null && !Array.isArray(value) && isBinding(value as never)) {
          sources.add((value as { source: string }).source);
        }
      }
    }
    expect(sources).toEqual(new Set(SOURCES));

    for (const type of LAYER_TYPES) {
      for (const field of fieldsFor(type)) {
        if (field.kind !== "enum" || field.key === "blend") continue;
        const used = new Set(layers.filter((layer) => layer.type === type).map((layer) => layer[field.key]));
        expect(used, `${type}.${field.key}`).toEqual(new Set(field.options.map((option) => option.value)));
      }
    }
  });
});
