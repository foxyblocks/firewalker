// The recipe format: a pattern described as data, not code. A recipe is a stack of up to
// eight layers drawn bottom first, each wired to tilt, stomps, time, audio, or slosh. The
// designer saves recipes as JSON in the repo's patterns/ folder, and later firmware will run
// them from flash. docs/recipe-format.md is the reference; this file and spec.ts are its
// source of truth in code.

export const RECIPE_FORMAT = "firewalker-recipe";
export const MIN_RECIPE_VERSION = 1;
export const RECIPE_VERSION = 3;
export type RecipeVersion = 1 | 2 | typeof RECIPE_VERSION;

export function isRecipeVersion(value: unknown): value is RecipeVersion {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_RECIPE_VERSION && value <= RECIPE_VERSION;
}

export const MAX_LAYERS = 8;
export const MAX_PALETTE_STOPS = 16;
// The boot lists patterns by name and `pattern <name>` has to fit a 20-byte BLE write.
export const MAX_NAME_LENGTH = 12;
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_LABEL_LENGTH = 24;

// A color as "#rrggbb".
export type Color = string;

// Inputs a knob can follow. Each reads 0..1, and the binding maps that onto min..max. The
// order is the binary format's numbering, so new sources only ever go on the end.
export const SOURCES = ["tilt", "tiltAmount", "stompStrength", "stompFade", "wave", "audioLevel", "slosh", "sloshAmount"] as const;
export type Source = (typeof SOURCES)[number];

// The format version that first had each source. A recipe is saved as the earliest version
// that holds everything it uses, so a boot with older firmware still reads every recipe that
// doesn't need a newer source. Example: binding one knob to `slosh` makes a recipe version 3.
export const SOURCE_VERSION: Record<Source, RecipeVersion> = {
  tilt: 1,
  tiltAmount: 1,
  stompStrength: 1,
  stompFade: 1,
  wave: 1,
  audioLevel: 2,
  slosh: 3,
  sloshAmount: 3,
};

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

// The format version that first had the Band layer. Every other layer type is in version 1.
const BAND_VERSION: RecipeVersion = 2;

/**
 * The earliest firmware format that can run these layers. Old effects retain
 * version 1 bytes, Band or an audio binding needs version 2, and a slosh binding
 * needs version 3. JSON saving also uses this to upgrade drafts made before a
 * source had its own version.
 */
export function requiredRecipeVersion(layers: readonly Layer[]): RecipeVersion {
  let version: RecipeVersion = MIN_RECIPE_VERSION;
  const need = (needed: RecipeVersion) => {
    if (needed > version) version = needed;
  };
  for (const layer of layers) {
    if (layer.type === "band") need(BAND_VERSION);
  }
  for (const source of boundSources(layers)) need(SOURCE_VERSION[source]);
  return version;
}

/** Every source a knob in these layers follows, one entry per bound knob. */
export function boundSources(layers: readonly Layer[]): Source[] {
  const sources: Source[] = [];
  for (const layer of layers) {
    for (const value of Object.values(layer)) {
      // A layer's object-valued fields are its palette, which is a list, and its bound knobs.
      if (typeof value === "object" && value !== null && !Array.isArray(value)) sources.push((value as Binding).source);
    }
  }
  return sources;
}

/**
 * Whether any enabled layer follows the slosh signal. The simulator's clip recorder uses
 * this to add its push-and-stop scene, which is the only motion that shows slosh off.
 */
export function usesSlosh(recipe: Recipe): boolean {
  const enabled = recipe.layers.filter((layer) => layer.enabled);
  return boundSources(enabled).some((source) => source === "slosh" || source === "sloshAmount");
}
