// Reference frames: what this TypeScript engine draws for a fixed script of motion, saved so the
// firmware's C++ engine can be checked against it without a boot. A native test can run the
// same inputs through C++ and compare the pixels.
//
// They only use the small test recipes in test/fixtures/recipe-frames/recipes/, which exist to
// exercise every layer type, blend, choice, and knob source. Recipes in patterns/ aren't
// involved, so designing a pattern never changes these files. Each test recipe is compiled and
// decoded before it runs, so the frames show what a boot would really be given, and rounding from
// the binary format can't cause a false failure. Its compiled bytes are saved too, for the C++ test
// to load. They also pin the binary layout: reordering a field changes them, and a test notices.
//
// This module builds the files and has no Node imports. referenceFrames.test.ts reads the test
// recipes, writes the files to test/fixtures/recipe-frames/, and fails when they're out of date.
// The README in that folder describes the file formats. A case is one recipe on one strip layout.

import { RecipeEngine, type EngineInput } from "./engine";
import { toChannelByte } from "./output";
import { BENCH_STRIP, BOOT_3EB5, type StripLayout } from "./strip";
import { compileRecipe, decodeRecipe } from "../recipe/compile";
import type { Recipe } from "../recipe/types";

const FILE_FORMAT = 1;
export const REFERENCE_FRAMES = 400;
// Frames saved, as "after every this many". The engine still runs every frame in between, so
// a difference in how state builds up shows at the next saved frame.
export const CHECK_EVERY = 16;

// Frame times in ms. The firmware's frames aren't perfectly even, and a stall happens now and then,
// including one past the 250 ms that both engines limit a step to.
const FRAME_TIMES = [16, 16, 17, 16, 16, 16, 33, 16, 15, 16];
const STALL_FRAME = 200;
const STALL_MS = 400;

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
      dt: frame === STALL_FRAME ? STALL_MS : FRAME_TIMES[frame % FRAME_TIMES.length]!,
    };
  });
}

export interface ReferenceCase {
  file: string;
  recipe: Recipe;
  layoutName: string;
  layout: StripLayout;
}

// Every test recipe runs on two layouts that catch different bugs: the bench strip runs toe
// first with even arcs, and a real boot runs heel first with uneven ones.
const LAYOUTS: { name: string; layout: StripLayout }[] = [
  { name: "bench", layout: BENCH_STRIP },
  { name: "3eb5", layout: BOOT_3EB5 },
];

export function referenceCases(recipes: Recipe[]): ReferenceCase[] {
  return recipes.flatMap((recipe) => {
    const onBoot = decodeCompiled(recipe);
    return LAYOUTS.map(({ name, layout }) => ({ file: `${recipe.name}--${name}.bin`, recipe: onBoot, layoutName: name, layout }));
  });
}

function compiledBytes(recipe: Recipe): Uint8Array {
  const compiled = compileRecipe(recipe);
  if (!compiled.ok) throw new Error(`${recipe.name}: ${compiled.errors.join(" ")}`);
  return compiled.bytes;
}

// The recipe as a boot would have it after compiling.
function decodeCompiled(recipe: Recipe): Recipe {
  const decoded = decodeRecipe(compiledBytes(recipe));
  if (!decoded.ok) throw new Error(`${recipe.name}: ${decoded.error}`);
  return decoded.recipe;
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

// Every generated file, by its path inside test/fixtures/recipe-frames/. `recipes` are the test
// recipes from that folder's recipes/ subfolder, in file-name order.
export function buildReferenceFiles(recipes: Recipe[]): Map<string, Uint8Array> {
  const encoder = new TextEncoder();
  const inputs = referenceInputs();
  const cases = referenceCases(recipes);
  const files = new Map<string, Uint8Array>();
  files.set("inputs.bin", encodeInputs(inputs));
  for (const testCase of cases) files.set(testCase.file, encodeCase(testCase, inputs));
  for (const recipe of recipes) files.set(`compiled/${recipe.name}.bin`, compiledBytes(recipe));
  const manifest = {
    format: FILE_FORMAT,
    frames: REFERENCE_FRAMES,
    checkEvery: CHECK_EVERY,
    cases: cases.map(({ file, recipe, layoutName, layout }) => ({
      file,
      recipe: `recipes/${recipe.name}.json`,
      compiled: `compiled/${recipe.name}.bin`,
      layout: layoutName,
      ...layout,
    })),
  };
  files.set("manifest.json", encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`));
  return files;
}
