// The compiler: turns a recipe into the small binary a boot stores and runs, and back again.
//
// A boot never reads JSON. A flash entry holds 254 bytes and a command holds 48, while a recipe's
// JSON runs past 1,000. So the designer compiles it here, and the same bytes go to every boot,
// whether they're built into the firmware or uploaded over BLE or USB. This module has no Node
// imports because both the browser and the dev server use it.
//
// `specs/recipe-engine-spec.md` has the layout as a table. Each layer's fields come in fieldsFor's
// order from spec.ts, with no field names, so reordering a field or an option changes what saved
// recipes mean. The test recipes' compiled bytes are checked in beside the reference frames to
// catch that. The firmware's decoder in include/firewalker_recipe.h reads the same layout, from
// tables that generateTables.ts writes out of spec.ts.

import { fieldsFor, STOMP_FADE, WAVE_PERIOD, type Field, type KnobField } from "./spec.ts";
import { isBinding, MAX_LAYERS, MAX_NAME_LENGTH, MAX_PALETTE_STOPS, RECIPE_FORMAT, RECIPE_VERSION, SOURCES, type Binding, type Layer, type LayerType, type Recipe } from "./types.ts";
import { nameProblem, validateRecipe } from "./validate.ts";

// NVM3's largest entry, so one recipe saves all at once and a power cut can't leave half of it.
export const MAX_COMPILED_BYTES = 254;

// A layer type's number in the binary. This order is part of the format.
export const LAYER_CODES: readonly LayerType[] = ["fill", "pool", "trail", "flash", "sparkle", "chase"];

// Scaled numbers fill an int16 across the field's range. For a speed of 60 on a field that runs
// from -400 to 400, that's round(60 / 400 * 32767) = 4915, which reads back as 59.9994.
const SCALE = 32767;

// `size` is what the recipe would take, for the designer's meter. It's null when the recipe is too
// broken to compile at all.
export type CompileResult = { ok: true; bytes: Uint8Array; size: number } | { ok: false; errors: string[]; size: number | null };
export type DecodeResult = { ok: true; recipe: Recipe } | { ok: false; error: string };

// CRC-32, the common zlib polynomial. It matches settingsCrc in include/firewalker_settings.h, and
// its value goes last in the binary and in `recipe info` replies.
export function recipeCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function scaleRange(field: { min: number; max: number }): number {
  return Math.max(Math.abs(field.min), Math.abs(field.max));
}

function pushUint16(out: number[], value: number): void {
  out.push(value & 0xff, (value >> 8) & 0xff);
}

function pushScaled(out: number[], value: number, field: { min: number; max: number }): void {
  pushUint16(out, Math.round((value / scaleRange(field)) * SCALE) & 0xffff);
}

function pushKnob(out: number[], value: Layer[keyof Layer], field: KnobField): void {
  if (!isBinding(value as never)) {
    pushScaled(out, value as number, field);
    return;
  }
  const binding = value as Binding;
  out.push(SOURCES.indexOf(binding.source));
  pushScaled(out, binding.min, field);
  pushScaled(out, binding.max, field);
  if (binding.source === "wave") pushUint16(out, binding.periodMs ?? WAVE_PERIOD.default);
  if (binding.source === "stompFade") pushUint16(out, binding.fadeMs ?? STOMP_FADE.default);
}

function pushLayer(out: number[], layer: Layer): void {
  const values = layer as unknown as Record<string, unknown>;
  const fields = fieldsFor(layer.type);
  const knobs = fields.filter((field) => field.kind === "knob");
  // One bit per knob, in field order, set when that knob is a binding, so a fixed knob needs no
  // marker of its own.
  const boundMask = knobs.reduce((mask, field, k) => (isBinding(values[field.key] as never) ? mask | (1 << k) : mask), 0);
  out.push(LAYER_CODES.indexOf(layer.type), boundMask);

  for (const field of fields) {
    const value = values[field.key];
    switch (field.kind) {
      case "enum":
        out.push(field.options.findIndex((option) => option.value === value));
        break;
      case "number":
        if (field.integer) pushUint16(out, value as number);
        else pushScaled(out, value as number, field);
        break;
      case "palette": {
        const colors = value as string[];
        out.push(colors.length);
        for (const color of colors) {
          const rgb = parseInt(color.slice(1), 16);
          out.push(rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff);
        }
        break;
      }
      case "knob":
        pushKnob(out, value as never, field);
        break;
    }
  }
}

// Compiles a recipe for a boot, or says in plain language why it can't. This drops what a boot has
// no use for: the description, layer labels, and disabled layers, since a boot can't turn one on.
export function compileRecipe(recipe: Recipe): CompileResult {
  const validation = validateRecipe(recipe);
  if (!validation.ok) return { ok: false, errors: validation.errors, size: null };

  const layers = recipe.layers.filter((layer) => layer.enabled);
  if (layers.length === 0) return { ok: false, errors: ["Turn on at least one layer. A boot can't run a recipe with none on."], size: null };

  const out: number[] = [RECIPE_VERSION, recipe.name.length];
  for (const char of recipe.name) out.push(char.charCodeAt(0));
  out.push(layers.length);
  for (const layer of layers) pushLayer(out, layer);

  const size = out.length + 4;
  if (size > MAX_COMPILED_BYTES) {
    return {
      ok: false,
      errors: [`This recipe compiles to ${size} bytes, ${size - MAX_COMPILED_BYTES} over a boot's limit of ${MAX_COMPILED_BYTES}. Try fewer colors or layers.`],
      size,
    };
  }

  const crc = recipeCrc(Uint8Array.from(out));
  out.push(crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24);
  return { ok: true, bytes: Uint8Array.from(out), size };
}

// Reads a number from the binary and refuses to read past the end.
class Reader {
  at = 0;
  constructor(
    readonly bytes: Uint8Array,
    readonly end: number,
  ) {}

  uint8(): number {
    if (this.at >= this.end) throw new Error("The recipe ends too soon.");
    return this.bytes[this.at++]!;
  }

  uint16(): number {
    const low = this.uint8();
    return low | (this.uint8() << 8);
  }

  // Single precision throughout, as on the firmware, so both read exactly the same value.
  scaled(field: { min: number; max: number }): number {
    const raw = (this.uint16() << 16) >> 16;
    const value = Math.fround(Math.fround(raw / SCALE) * Math.fround(scaleRange(field)));
    return Math.min(Math.fround(field.max), Math.max(Math.fround(field.min), value));
  }
}

function readChoice(reader: Reader, field: Field & { kind: "enum" }): string {
  const option = field.options[reader.uint8()];
  if (!option) throw new Error(`${field.key} has an unknown option.`);
  return option.value;
}

function readPalette(reader: Reader): string[] {
  const count = reader.uint8();
  if (count === 0 || count > MAX_PALETTE_STOPS) throw new Error(`A palette needs 1 to ${MAX_PALETTE_STOPS} colors.`);
  return Array.from({ length: count }, () => {
    const rgb = (reader.uint8() << 16) | (reader.uint8() << 8) | reader.uint8();
    return `#${rgb.toString(16).padStart(6, "0")}`;
  });
}

function readBinding(reader: Reader, field: KnobField): Binding {
  const source = SOURCES[reader.uint8()];
  if (!source) throw new Error(`${field.key} has an unknown source.`);
  const binding: Binding = { source, min: reader.scaled(field), max: reader.scaled(field) };
  if (source === "wave") binding.periodMs = Math.min(WAVE_PERIOD.max, Math.max(WAVE_PERIOD.min, reader.uint16()));
  if (source === "stompFade") binding.fadeMs = Math.min(STOMP_FADE.max, Math.max(STOMP_FADE.min, reader.uint16()));
  return binding;
}

function readLayer(reader: Reader): Layer {
  const type = LAYER_CODES[reader.uint8()];
  if (!type) throw new Error("A layer has an unknown type.");
  const boundMask = reader.uint8();
  const layer: Record<string, unknown> = { type, enabled: true };
  let knobIndex = 0;
  for (const field of fieldsFor(type)) {
    switch (field.kind) {
      case "enum":
        layer[field.key] = readChoice(reader, field);
        break;
      case "number":
        layer[field.key] = field.integer ? Math.min(field.max, Math.max(field.min, reader.uint16())) : reader.scaled(field);
        break;
      case "palette":
        layer[field.key] = readPalette(reader);
        break;
      case "knob":
        layer[field.key] = boundMask & (1 << knobIndex) ? readBinding(reader, field) : reader.scaled(field);
        knobIndex++;
        break;
    }
  }
  return layer as unknown as Layer;
}

// Turns compiled bytes back into a recipe, with the same checks as the firmware's decoder: it
// refuses a wrong version, a bad checksum, or anything malformed, and limits every number to its
// field's range. The result is what a boot would run, so the reference frames come from it, and
// any rounding from the binary shows up on both sides of that comparison.
export function decodeRecipe(bytes: Uint8Array): DecodeResult {
  try {
    if (bytes.length > MAX_COMPILED_BYTES) throw new Error(`A recipe is at most ${MAX_COMPILED_BYTES} bytes.`);
    if (bytes.length < 4) throw new Error("The recipe ends too soon.");
    const end = bytes.length - 4;
    const stored = (bytes[end]! | (bytes[end + 1]! << 8) | (bytes[end + 2]! << 16) | (bytes[end + 3]! << 24)) >>> 0;
    if (stored !== recipeCrc(bytes.subarray(0, end))) throw new Error("The checksum doesn't match.");

    const reader = new Reader(bytes, end);
    const version = reader.uint8();
    if (version !== RECIPE_VERSION) throw new Error(`Version ${version} isn't supported.`);

    const nameLength = reader.uint8();
    if (nameLength === 0 || nameLength > MAX_NAME_LENGTH) throw new Error("The name is the wrong length.");
    const name = String.fromCharCode(...Array.from({ length: nameLength }, () => reader.uint8()));
    const problem = nameProblem(name);
    if (problem) throw new Error(problem);

    const layerCount = reader.uint8();
    if (layerCount === 0 || layerCount > MAX_LAYERS) throw new Error(`A recipe holds 1 to ${MAX_LAYERS} layers.`);
    const layers = Array.from({ length: layerCount }, () => readLayer(reader));
    if (reader.at !== end) throw new Error("There are extra bytes after the last layer.");

    return { ok: true, recipe: { format: RECIPE_FORMAT, version: RECIPE_VERSION, name, description: "", layers } };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
