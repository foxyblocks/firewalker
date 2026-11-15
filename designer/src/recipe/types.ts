// The recipe format: a pattern described as data, not code. A recipe is a stack of up to
// eight layers drawn bottom first, each wired to tilt, stomps, time, or audio. The
// designer saves recipes as JSON in the repo's patterns/ folder, and later firmware will run
// them from flash. docs/recipe-format.md is the reference; this file and spec.ts are its
// source of truth in code.

export const RECIPE_FORMAT = "firewalker-recipe";
export const MIN_RECIPE_VERSION = 1;
export const RECIPE_VERSION = 2;
export type RecipeVersion = 1 | typeof RECIPE_VERSION;

export function isRecipeVersion(value: unknown): value is RecipeVersion {
  return value === MIN_RECIPE_VERSION || value === RECIPE_VERSION;
}

export const MAX_LAYERS = 8;
export const MAX_PALETTE_STOPS = 16;
// The boot lists patterns by name and `pattern <name>` has to fit a 20-byte BLE write. The
// limit lives in shared/recipeBinary.ts with the rest of the name rule.
export { MAX_NAME_LENGTH } from "../../../shared/recipeBinary.ts";
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_LABEL_LENGTH = 24;

// A color as "#rrggbb".
export type Color = string;

// Inputs a knob can follow. Each reads 0..1, and the binding maps that onto min..max.
export const SOURCES = ["tilt", "tiltAmount", "stompStrength", "stompFade", "wave", "audioLevel"] as const;
export type Source = (typeof SOURCES)[number];

export interface Binding {
  source: Source;
  min: number;
  max: number;
  // wave only: one full cycle, in ms.
  periodMs?: number;
  // stompFade only: how long the value takes to fall from 1 to 0 after a stomp, in ms.
  fadeMs?: number;
}

// A knob is a fixed number, or a binding that follows one of the sources.
export type Knob = number | Binding;

export const BLENDS = ["over", "add", "max", "multiply"] as const;
export type Blend = (typeof BLENDS)[number];

// Which stomps fire a layer. Flat means the boot's tilt reads exactly 0, which the
// firmware's dead zone guarantees at rest.
export const TRIGGERS = ["any", "flat", "tilted"] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const SPREADS = ["solid", "ring", "foot"] as const;
export type Spread = (typeof SPREADS)[number];
export const CHASE_PATHS = ["ring", "foot"] as const;
export type ChasePath = (typeof CHASE_PATHS)[number];

export const TRAIL_ORIGINS = ["down-point", "down-end"] as const;
export type TrailOrigin = (typeof TRAIL_ORIGINS)[number];

interface LayerCommon {
  // A name for the layer in the designer. The boot never sees it.
  label?: string;
  enabled: boolean;
  blend: Blend;
  opacity: Knob;
}

// Colors the whole strip from a looping palette.
export interface FillLayer extends LayerCommon {
  type: "fill";
  palette: Color[];
  spread: Spread;
  repeat: Knob;
  offset: Knob;
  scroll: Knob;
  brightness: Knob;
}

// Flow's tilt gauge: pools brightness toward whichever end is down. Usually multiplies.
export interface PoolLayer extends LayerCommon {
  type: "pool";
  baseline: Knob;
}

// Bands launched by a stomp that travel along the strip.
export interface TrailLayer extends LayerCommon {
  type: "trail";
  trigger: Trigger;
  from: TrailOrigin;
  flatZone: number;
  palette: Color[];
  speed: Knob;
  length: number;
  brightness: Knob;
  maxFronts: number;
}

// A whole-strip flash on a stomp that fades out.
export interface FlashLayer extends LayerCommon {
  type: "flash";
  trigger: Trigger;
  palette: Color[];
  fadeMs: number;
  brightness: Knob;
}

// Random twinkles.
export interface SparkleLayer extends LayerCommon {
  type: "sparkle";
  palette: Color[];
  density: Knob;
  fadeMs: number;
  brightness: Knob;
}

// Comets that circle the ring.
export interface ChaseLayer extends LayerCommon {
  type: "chase";
  path: ChasePath;
  palette: Color[];
  count: number;
  speed: Knob;
  length: number;
  brightness: Knob;
}

// A gray mask over the same heel-to-toe interval on both sides of the boot.
// Position slides the whole band between the ends, keeping its width intact.
// Multiply it against a fill to turn that fill into a movable volume bar.
export interface BandLayer extends LayerCommon {
  type: "band";
  position: Knob;
  width: Knob;
}

export type Layer = FillLayer | PoolLayer | TrailLayer | FlashLayer | SparkleLayer | ChaseLayer | BandLayer;
export type LayerType = Layer["type"];

export interface Recipe {
  format: typeof RECIPE_FORMAT;
  version: RecipeVersion;
  name: string;
  // Notes for people. Stays in the file and is never sent to a boot.
  description: string;
  layers: Layer[];
}

export function isBinding(knob: Knob): knob is Binding {
  return typeof knob === "object" && knob !== null;
}

/**
 * The earliest firmware format that can run these layers. Old effects retain
 * version 1 bytes, while Band or an audio binding needs version 2. JSON saving
 * also uses this to upgrade drafts made before audio had its own version.
 */
export function requiredRecipeVersion(layers: readonly Layer[]): RecipeVersion {
  const needsAudioFormat = layers.some((layer) =>
    layer.type === "band" || Object.values(layer).some((value) => isBinding(value) && value.source === "audioLevel"),
  );
  return needsAudioFormat ? RECIPE_VERSION : MIN_RECIPE_VERSION;
}
