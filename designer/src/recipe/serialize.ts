// Writes a recipe the same way every time: fields in file order, two-space indent, and a
// trailing newline, with each palette and each binding on one line. Files in patterns/ then
// read easily and diff cleanly in a pull request.

import { fieldsFor } from "./spec.ts";
import { isBinding, RECIPE_FORMAT, RECIPE_VERSION, type Knob, type Layer, type Recipe } from "./types.ts";

export function orderRecipe(recipe: Recipe): Recipe {
  return {
    format: RECIPE_FORMAT,
    version: RECIPE_VERSION,
    name: recipe.name,
    description: recipe.description,
    layers: recipe.layers.map(orderLayer),
  };
}

function orderLayer(layer: Layer): Layer {
  const source = layer as unknown as Record<string, unknown>;
  const ordered: Record<string, unknown> = { type: layer.type };
  if (layer.label) ordered.label = layer.label;
  ordered.enabled = layer.enabled;
  for (const field of fieldsFor(layer.type)) {
    const value = source[field.key];
    ordered[field.key] = field.kind === "knob" ? orderKnob(value as Knob) : value;
  }
  return ordered as unknown as Layer;
}

function orderKnob(knob: Knob): Knob {
  if (!isBinding(knob)) return knob;
  const ordered: Knob = { source: knob.source, min: knob.min, max: knob.max };
  if (knob.source === "wave" && knob.periodMs !== undefined) ordered.periodMs = knob.periodMs;
  if (knob.source === "stompFade" && knob.fadeMs !== undefined) ordered.fadeMs = knob.fadeMs;
  return ordered;
}

// A palette: an array of only color strings. A binding: an object that starts with "source".
// Neither can hold a nested array or object, and JSON strings can't hold a raw newline, so
// these patterns only ever match whole palettes and bindings.
const PALETTE = /\[\n\s+("#[0-9a-f]{6}"(?:,\n\s+"#[0-9a-f]{6}")*)\n\s+\]/g;
const BINDING = /\{\n\s+("source": [^{}[\]]*?)\n\s+\}/g;

export function recipeToJson(recipe: Recipe): string {
  const json = JSON.stringify(orderRecipe(recipe), null, 2)
    .replace(PALETTE, (_, items: string) => `[${items.replace(/,\n\s+/g, ", ")}]`)
    .replace(BINDING, (_, items: string) => `{ ${items.replace(/,\n\s+/g, ", ")} }`);
  return `${json}\n`;
}
