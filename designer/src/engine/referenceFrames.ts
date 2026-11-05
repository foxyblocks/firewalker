// Reference frames: what this TypeScript engine draws for a fixed script of motion, saved so the
// firmware's C++ engine can be checked against it without a boot. A native test can run the
// same inputs through C++ and compare the pixels.
//
// This module builds the files and has no Node imports. referenceFrames.test.ts writes them to
// test/fixtures/recipe-frames/ and fails when they're out of date. The README in that folder
// describes the file formats.
//
// A case is one recipe on one strip layout. The kept recipes in patterns/ show real patterns,
// and the small recipes here make sure every layer type, blend, choice, and knob source gets
// exercised, including ones no kept recipe happens to use.

import { RecipeEngine, type EngineInput } from "./engine";
import { toChannelByte } from "./output";
import { BENCH_STRIP, BOOT_3EB5, type StripLayout } from "./strip";
import { recipeToJson } from "../recipe/serialize";
import { newLayer } from "../recipe/spec";
import { RECIPE_FORMAT, RECIPE_VERSION, type Layer, type LayerType, type Recipe } from "../recipe/types";

const FILE_FORMAT = 1;
export const REFERENCE_FRAMES = 400;
// Frames saved, as "after every this many". The engine still runs every frame in between, so
// a difference in how state builds up shows at the next saved frame.
export const CHECK_EVERY = 16;

// Frame times in ms. The firmware's frames aren't perfectly even, and a stall happens now and then.
const FRAME_TIMES = [16, 16, 17, 16, 16, 16, 33, 16, 15, 16];

// Stomps as frame number and strength. Some land at exactly level, so `flat` triggers fire, and
// frames 40 and 42 overlap, so a second stomp lands while the first one's effects are running.
const STOMPS = new Map<number, number>([
  [10, 0.2],
  [40, 1],
  [42, 0.6],
  [90, 0.5],
  [130, 0.9],
  [180, 0.7],
  [215, 0.3],
  [260, 1],
  [310, 0.6],
  [350, 0.4],
  [390, 0.8],
]);

// The firmware reads exactly 0 within its dead zone near level. This is about the same width.
const DEAD_ZONE = 0.03;

// Tilt over the script: flat, a slow ramp to full toe, a sweep to full heel, back to flat, then
// a rocking motion like walking.
function scriptTilt(frame: number): number {
  let tilt: number;
  if (frame < 60) tilt = 0;
  else if (frame < 140) tilt = (frame - 60) / 80;
  else if (frame < 220) tilt = 1 - (2 * (frame - 140)) / 80;
  else if (frame < 300) tilt = -1 + (frame - 220) / 80;
  else tilt = 0.6 * Math.sin((2 * Math.PI * (frame - 300)) / 100);
  return Math.abs(tilt) < DEAD_ZONE ? 0 : tilt;
}

// The same inputs for every case. Tilt and strength are single-precision values, since that's
// what the C++ test reads from the file and what the firmware's sensor code produces.
export function referenceInputs(): EngineInput[] {
  return Array.from({ length: REFERENCE_FRAMES }, (_, frame) => {
    const strength = STOMPS.get(frame);
    return {
      tiltFwd: Math.fround(scriptTilt(frame)),
      stomp: strength !== undefined,
      stompStrength: Math.fround(strength ?? 0),
      dt: FRAME_TIMES[frame % FRAME_TIMES.length]!,
    };
  });
}

function layer(type: LayerType, overrides: Record<string, unknown> = {}): Layer {
  return { ...newLayer(type), ...overrides } as Layer;
}

function fixture(name: string, ...layers: Layer[]): Recipe {
  return { format: RECIPE_FORMAT, version: RECIPE_VERSION, name, description: "", layers };
}

const RAINBOW = ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"];
const EMBER = ["#ffffff", "#ffc800", "#ff3c00"];
const ICE = ["#ffffff", "#7fe8ff", "#0080ff"];

export const FIXTURE_RECIPES: Recipe[] = [
  fixture(
    "band",
    layer("fill", { palette: ["#ffffff"], scroll: 0 }),
    layer("band", {
      position: { source: "tilt", min: 0, max: 1 },
      width: { source: "wave", min: 0, max: 1, periodMs: 1600 },
    }),
  ),
  fixture("fill-solid", layer("fill", { spread: "solid", palette: RAINBOW, scroll: { source: "tilt", min: -1, max: 1 } })),
  fixture(
    "fill-ring",
    layer("fill", {
      spread: "ring",
      palette: RAINBOW,
      repeat: { source: "wave", min: 1, max: 3, periodMs: 1500 },
      offset: { source: "stompFade", min: 0, max: 0.5, fadeMs: 800 },
      scroll: -0.5,
    }),
  ),
  fixture(
    "fill-foot",
    layer("fill", {
      spread: "foot",
      palette: EMBER,
      repeat: 2,
      scroll: { source: "stompStrength", min: 0, max: 1 },
      brightness: { source: "tiltAmount", min: 0.2, max: 1 },
    }),
  ),
  fixture(
    "pool",
    layer("fill", { palette: ["#00ff80"], scroll: 0 }),
    layer("pool", { baseline: { source: "wave", min: 0.2, max: 0.9, periodMs: 3000 } }),
  ),
  fixture(
    "trail-point",
    layer("trail", { trigger: "flat", from: "down-point", palette: EMBER, length: 12 }),
    layer("trail", { trigger: "any", from: "down-point", palette: ICE, speed: 90, length: 5, blend: "add" }),
  ),
  fixture(
    "trail-end",
    layer("trail", {
      trigger: "tilted",
      from: "down-end",
      flatZone: 0.3,
      palette: EMBER,
      speed: { source: "tilt", min: 20, max: 200 },
      length: 8,
      maxFronts: 3,
    }),
    layer("trail", { trigger: "any", from: "down-end", flatZone: 0.6, palette: ICE, speed: 60, brightness: 0.5, blend: "max" }),
  ),
  fixture(
    "flash",
    layer("fill", { palette: ["#101030"], scroll: 0 }),
    layer("flash", { trigger: "any", palette: ["#402000"], fadeMs: 300, blend: "add" }),
    layer("flash", { trigger: "flat", palette: ["#ffffff", "#ff0000", "#000000"], fadeMs: 700 }),
    layer("flash", { trigger: "tilted", palette: ICE, fadeMs: 500, brightness: { source: "stompStrength", min: 0.2, max: 0.8 }, blend: "max" }),
  ),
  fixture(
    "sparkle",
    layer("sparkle", { palette: ["#ffffff", "#9fd8ff"], density: 30, fadeMs: 400 }),
    layer("sparkle", {
      palette: EMBER,
      density: { source: "stompFade", min: 0, max: 150, fadeMs: 1200 },
      fadeMs: 900,
      blend: "over",
      opacity: { source: "wave", min: 0.3, max: 1, periodMs: 1100 },
    }),
  ),
  fixture(
    "chase-ring",
    layer("chase", { path: "ring", palette: ICE, count: 3, speed: { source: "wave", min: -100, max: 100, periodMs: 2000 }, length: 12, blend: "max" }),
    layer("chase", { path: "ring", palette: ["#ff00ff"], count: 1, speed: 37.5, length: 1, blend: "add" }),
  ),
  fixture(
    "chase-foot",
    layer("chase", { path: "foot", palette: EMBER, count: 2, speed: -60, length: 9 }),
    layer("chase", { path: "foot", palette: ICE, count: 1, speed: { source: "tilt", min: -120, max: 120 }, length: 6, blend: "add" }),
  ),
  fixture(
    "blends",
    layer("fill", { spread: "ring", palette: RAINBOW, scroll: 0.2 }),
    layer("fill", { palette: ["#804000"], scroll: 0, blend: "over", opacity: { source: "wave", min: 0, max: 0.8, periodMs: 900 } }),
    layer("fill", { palette: ["#004080"], scroll: 0, blend: "add", opacity: { source: "stompFade", min: 0, max: 1, fadeMs: 600 } }),
    layer("fill", { palette: ["#208020"], scroll: 0, blend: "max", opacity: { source: "tilt", min: 0, max: 1 } }),
    layer("fill", { palette: ["#c0c0ff"], scroll: 0, blend: "multiply", opacity: { source: "tiltAmount", min: 0, max: 1 } }),
  ),
];

export interface ReferenceCase {
  file: string;
  recipe: Recipe;
  source: "patterns" | "fixture";
  layoutName: string;
  layout: StripLayout;
}

// Kept recipes run on the bench strip and a real boot, whose uneven arcs catch different bugs.
// The fixtures only need one layout, which keeps the files small.
export function referenceCases(keepers: Recipe[]): ReferenceCase[] {
  const make = (recipe: Recipe, source: ReferenceCase["source"], layoutName: string, layout: StripLayout): ReferenceCase => ({
    file: `${recipe.name}--${layoutName}.bin`,
    recipe,
    source,
    layoutName,
    layout,
  });
  return [
    ...keepers.flatMap((recipe) => [make(recipe, "patterns", "bench", BENCH_STRIP), make(recipe, "patterns", "3eb5", BOOT_3EB5)]),
    ...FIXTURE_RECIPES.map((recipe) => make(recipe, "fixture", "3eb5", BOOT_3EB5)),
  ];
}

// Runs one case and returns the saved frames, each one R, G, B bytes per pixel, in the 0..255
// values a boot stores before its brightness setting. The first saved frame is after
// CHECK_EVERY updates.
export function renderCase(recipe: Recipe, layout: StripLayout, inputs: EngineInput[]): Uint8Array {
  const engine = new RecipeEngine(recipe, layout);
  engine.enter();
  const checkpoints = Math.floor(inputs.length / CHECK_EVERY);
  const bytes = new Uint8Array(checkpoints * layout.count * 3);
  let at = 0;
  inputs.forEach((input, frame) => {
    engine.update(input);
    if ((frame + 1) % CHECK_EVERY !== 0) return;
    for (const value of engine.frame) bytes[at++] = toChannelByte(value);
  });
  return bytes;
}

function encodeInputs(inputs: EngineInput[]): Uint8Array {
  const headerSize = 8;
  const recordSize = 12;
  const out = new Uint8Array(headerSize + inputs.length * recordSize);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("FWRI"));
  view.setUint16(4, FILE_FORMAT, true);
  view.setUint16(6, inputs.length, true);
  inputs.forEach((input, i) => {
    const at = headerSize + i * recordSize;
    view.setFloat32(at, input.tiltFwd, true);
    view.setFloat32(at + 4, input.stompStrength, true);
    view.setUint16(at + 8, input.dt, true);
    view.setUint8(at + 10, input.stomp ? 1 : 0);
  });
  return out;
}

function encodeCase(testCase: ReferenceCase, inputs: EngineInput[]): Uint8Array {
  const headerSize = 16;
  const { count, toe, heel } = testCase.layout;
  const frames = renderCase(testCase.recipe, testCase.layout, inputs);
  const out = new Uint8Array(headerSize + frames.length);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("FWRF"));
  view.setUint16(4, FILE_FORMAT, true);
  view.setUint16(6, count, true);
  view.setUint16(8, toe, true);
  view.setUint16(10, heel, true);
  view.setUint16(12, CHECK_EVERY, true);
  view.setUint16(14, frames.length / (count * 3), true);
  out.set(frames, headerSize);
  return out;
}

// Every generated file, by its path inside test/fixtures/recipe-frames/. `keepers` are the
// recipes in the repo's patterns/ folder, in file-name order.
export function buildReferenceFiles(keepers: Recipe[]): Map<string, Uint8Array> {
  const encoder = new TextEncoder();
  const inputs = referenceInputs();
  const cases = referenceCases(keepers);
  const files = new Map<string, Uint8Array>();
  files.set("inputs.bin", encodeInputs(inputs));
  for (const testCase of cases) files.set(testCase.file, encodeCase(testCase, inputs));
  for (const recipe of FIXTURE_RECIPES) files.set(`recipes/${recipe.name}.json`, encoder.encode(recipeToJson(recipe)));
  const manifest = {
    format: FILE_FORMAT,
    frames: REFERENCE_FRAMES,
    checkEvery: CHECK_EVERY,
    cases: cases.map(({ file, recipe, source, layoutName, layout }) => ({
      file,
      recipe: source === "patterns" ? `patterns/${recipe.name}.json` : `test/fixtures/recipe-frames/recipes/${recipe.name}.json`,
      layout: layoutName,
      ...layout,
    })),
  };
  files.set("manifest.json", encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`));
  return files;
}
