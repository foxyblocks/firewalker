// Checks that a value is a recipe the boot could run, and says what's wrong if not. The
// designer runs it before saving or importing, and the dev server runs it before writing a
// file, so a recipe in patterns/ is always valid.

import { STOMP_FADE, WAVE_PERIOD, fieldsFor, LAYER_SPECS, type Field } from "./spec.ts";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_LAYERS,
  MAX_NAME_LENGTH,
  MAX_PALETTE_STOPS,
  RECIPE_FORMAT,
  isRecipeVersion,
  SOURCES,
  type LayerType,
  type Recipe,
} from "./types.ts";

export type Validation = { ok: true; recipe: Recipe } | { ok: false; errors: string[] };

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
// Names a recipe can't take. `off` is how the remote turns the strip off, and `flow` and
// `fire-trail` are the firmware's own patterns, which a boot lists alongside its recipes by
// name. Keep this in step with SELECTABLE_PATTERNS in include/firewalker_remote_protocol.h.
export const RESERVED_NAMES: ReadonlySet<string> = new Set(["off", "flow", "fire-trail"]);

// Returns a reason the name can't be used, or null if it's fine.
export function nameProblem(name: string): string | null {
  if (name.length === 0) return "Name is empty.";
  if (name.length > MAX_NAME_LENGTH) return `Name is longer than ${MAX_NAME_LENGTH} characters.`;
  if (!NAME_PATTERN.test(name)) return "Name must start with a letter and use only a-z, 0-9, and hyphens.";
  if (RESERVED_NAMES.has(name)) return `"${name}" is reserved.`;
  return null;
}

export function validateRecipe(value: unknown): Validation {
  const errors: string[] = [];
  if (!isObject(value)) return { ok: false, errors: ["A recipe must be a JSON object."] };

  if (value.format !== RECIPE_FORMAT) errors.push(`format must be "${RECIPE_FORMAT}".`);
  if (!isRecipeVersion(value.version)) errors.push("version must be 1 or 2.");

  if (typeof value.name !== "string") {
    errors.push("name must be a string.");
  } else {
    const problem = nameProblem(value.name);
    if (problem) errors.push(problem);
  }

  if (typeof value.description !== "string") {
    errors.push("description must be a string.");
  } else if (value.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description is longer than ${MAX_DESCRIPTION_LENGTH} characters.`);
  }

  if (!Array.isArray(value.layers)) {
    errors.push("layers must be a list.");
  } else {
    if (value.layers.length === 0) errors.push("A recipe needs at least one layer.");
    if (value.layers.length > MAX_LAYERS) errors.push(`A recipe holds at most ${MAX_LAYERS} layers.`);
    value.layers.forEach((layer, i) => checkLayer(layer, `Layer ${i + 1}`, errors));
  }

  unknownKeys(value, ["format", "version", "name", "description", "layers"], "The recipe", errors);

  return errors.length === 0 ? { ok: true, recipe: value as unknown as Recipe } : { ok: false, errors };
}

function checkLayer(layer: unknown, where: string, errors: string[]): void {
  if (!isObject(layer)) {
    errors.push(`${where} must be an object.`);
    return;
  }
  const type = layer.type;
  if (typeof type !== "string" || !(type in LAYER_SPECS)) {
    errors.push(`${where} has an unknown type ${JSON.stringify(type)}.`);
    return;
  }
  const at = `${where} (${type})`;
  if (typeof layer.enabled !== "boolean") errors.push(`${at}: enabled must be true or false.`);
  if (layer.label !== undefined && (typeof layer.label !== "string" || layer.label.length > MAX_LABEL_LENGTH)) {
    errors.push(`${at}: label must be text of at most ${MAX_LABEL_LENGTH} characters.`);
  }

  const fields = fieldsFor(type as LayerType);
  for (const field of fields) checkField(field, layer[field.key], at, errors);

  unknownKeys(layer, ["type", "label", "enabled", ...fields.map((f) => f.key)], at, errors);
}

function checkField(field: Field, value: unknown, at: string, errors: string[]): void {
  const where = `${at}: ${field.key}`;
  switch (field.kind) {
    case "number":
      if (!inRange(value, field.min, field.max)) {
        errors.push(`${where} must be a number from ${field.min} to ${field.max}.`);
      } else if (field.integer && !Number.isInteger(value)) {
        errors.push(`${where} must be a whole number.`);
      }
      return;

    case "enum":
      if (!field.options.some((o) => o.value === value)) {
        errors.push(`${where} must be one of ${field.options.map((o) => o.value).join(", ")}.`);
      }
      return;

    case "palette":
      if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PALETTE_STOPS) {
        errors.push(`${where} needs 1 to ${MAX_PALETTE_STOPS} colors.`);
      } else if (!value.every((c) => typeof c === "string" && COLOR_PATTERN.test(c))) {
        errors.push(`${where} colors must look like #ff8000, in lowercase.`);
      }
      return;

    case "knob":
      if (typeof value === "number") {
        if (!inRange(value, field.min, field.max)) errors.push(`${where} must be from ${field.min} to ${field.max}.`);
        return;
      }
      if (!isObject(value)) {
        errors.push(`${where} must be a number or a binding.`);
        return;
      }
      checkBinding(value, field, where, errors);
      return;
  }
}

function checkBinding(binding: Record<string, unknown>, field: Field & { kind: "knob" }, where: string, errors: string[]): void {
  const source = binding.source;
  if (typeof source !== "string" || !(SOURCES as readonly string[]).includes(source)) {
    errors.push(`${where}.source must be one of ${SOURCES.join(", ")}.`);
    return;
  }
  for (const end of ["min", "max"] as const) {
    if (!inRange(binding[end], field.min, field.max)) {
      errors.push(`${where}.${end} must be from ${field.min} to ${field.max}.`);
    }
  }
  const allowed = ["source", "min", "max"];
  if (source === "wave") {
    allowed.push("periodMs");
    if (binding.periodMs !== undefined && !inRange(binding.periodMs, WAVE_PERIOD.min, WAVE_PERIOD.max)) {
      errors.push(`${where}.periodMs must be from ${WAVE_PERIOD.min} to ${WAVE_PERIOD.max}.`);
    }
  }
  if (source === "stompFade") {
    allowed.push("fadeMs");
    if (binding.fadeMs !== undefined && !inRange(binding.fadeMs, STOMP_FADE.min, STOMP_FADE.max)) {
      errors.push(`${where}.fadeMs must be from ${STOMP_FADE.min} to ${STOMP_FADE.max}.`);
    }
  }
  unknownKeys(binding, allowed, where, errors);
}

function unknownKeys(value: Record<string, unknown>, allowed: string[], where: string, errors: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${where} has an unknown field "${key}".`);
  }
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
