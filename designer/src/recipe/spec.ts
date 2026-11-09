// What each layer type holds, with every field's range and default. The validator and the
// designer's inspector both read these, so a range lives in one place.

import type { Blend, Color, Knob, Layer, LayerType, Source } from "./types.ts";

interface FieldBase {
  key: string;
  label: string;
  help?: string;
  // Shown only while another field of the layer has this value. The file always keeps it.
  shownWhen?: { key: string; value: string };
}

// A number that can also follow a source.
export interface KnobField extends FieldBase {
  kind: "knob";
  min: number;
  max: number;
  step: number;
  unit?: string;
  default: Knob;
}

// A plain number, fixed while the layer runs.
export interface NumberField extends FieldBase {
  kind: "number";
  min: number;
  max: number;
  step: number;
  integer: boolean;
  unit?: string;
  default: number;
}

export interface EnumField extends FieldBase {
  kind: "enum";
  options: readonly { value: string; label: string }[];
  default: string;
}

export interface PaletteField extends FieldBase {
  kind: "palette";
  default: Color[];
}

export type Field = KnobField | NumberField | EnumField | PaletteField;

export interface LayerSpec {
  type: LayerType;
  title: string;
  summary: string;
  defaultBlend: Blend;
  fields: Field[];
}

export const PALETTE_PRESETS: { name: string; colors: Color[] }[] = [
  { name: "Rainbow", colors: ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"] },
  { name: "Fire", colors: ["#ffc800", "#ff9600", "#ff3c00", "#ff1400"] },
  { name: "Ice", colors: ["#ffffff", "#7fe8ff", "#0080ff", "#1a00ff"] },
  { name: "Ocean", colors: ["#00ffd0", "#0090ff", "#0018ff", "#00b0ff"] },
  { name: "Neon", colors: ["#ff00c8", "#7a00ff", "#00f0ff", "#b0ff00"] },
  { name: "Lava", colors: ["#ff2000", "#ff8000", "#ffd000", "#ff8000"] },
  { name: "White", colors: ["#ffffff"] },
];

export const SOURCE_LABELS: Record<Source, string> = {
  tilt: "Tilt (heel to toe)",
  tiltAmount: "Tilt amount",
  stompStrength: "Stomp strength",
  stompFade: "Stomp fade",
  wave: "Wave",
  audioLevel: "Audio level",
};

export const SOURCE_HELP: Record<Source, string> = {
  tilt: "Min at the heel pose, halfway when flat, max at the toe pose.",
  tiltAmount: "Min when flat, max at either full tilt.",
  stompStrength: "How hard the latest stomp hit. Holds until the next one.",
  stompFade: "Max at a stomp, falling back to min over the fade time.",
  wave: "A smooth loop between min and max.",
  audioLevel: "Follows the audio meter above the boot. Min in silence or when stopped, max at full level. Choose a source and click Listen.",
};

// Limits for the extra numbers a binding carries.
export const WAVE_PERIOD = { min: 100, max: 60000, default: 2000 } as const;
export const STOMP_FADE = { min: 50, max: 10000, default: 1000 } as const;

const opacity: KnobField = {
  kind: "knob",
  key: "opacity",
  label: "Opacity",
  min: 0,
  max: 1,
  step: 0.01,
  default: 1,
  help: "How strongly this layer applies over the ones below.",
};

const brightness = (fallback: Knob): KnobField => ({
  kind: "knob",
  key: "brightness",
  label: "Brightness",
  min: 0,
  max: 1,
  step: 0.01,
  default: fallback,
});

const trigger: EnumField = {
  kind: "enum",
  key: "trigger",
  label: "Stomps",
  options: [
    { value: "any", label: "Any" },
    { value: "flat", label: "Flat" },
    { value: "tilted", label: "Tilted" },
  ],
  default: "any",
  help: "Flat means the boot reads exactly level when the stomp lands.",
};

export const LAYER_SPECS: Record<LayerType, LayerSpec> = {
  fill: {
    type: "fill",
    title: "Fill",
    summary: "Colors the whole strip from a looping palette.",
    defaultBlend: "over",
    fields: [
      { kind: "palette", key: "palette", label: "Palette", default: ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"] },
      {
        kind: "enum",
        key: "spread",
        label: "Spread",
        options: [
          { value: "solid", label: "Solid" },
          { value: "ring", label: "Around ring" },
          { value: "foot", label: "Heel to toe" },
        ],
        default: "solid",
        help: "Solid is one color at a time. Around ring and heel to toe lay the palette along the strip.",
      },
      {
        kind: "knob",
        key: "repeat",
        label: "Repeat",
        min: 0.1,
        max: 8,
        step: 0.05,
        default: 1,
        help: "How many times the palette loops across the spread. 0.5 with two colors gives a plain gradient.",
      },
      { kind: "knob", key: "offset", label: "Offset", min: 0, max: 1, step: 0.01, default: 0, help: "Where in the palette to start." },
      {
        kind: "knob",
        key: "scroll",
        label: "Scroll",
        min: -4,
        max: 4,
        step: 0.01,
        unit: "loops/s",
        default: 0.0667,
        help: "How fast the palette moves. Negative runs it backward.",
      },
      brightness(1),
    ],
  },
  pool: {
    type: "pool",
    title: "Pool",
    summary: "Flow's tilt gauge: light drains from the up end and pools at the down end.",
    defaultBlend: "multiply",
    fields: [
      {
        kind: "knob",
        key: "baseline",
        label: "Baseline",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.8,
        help: "Brightness when flat. Survivors brighten to full as the tilt grows.",
      },
    ],
  },
  trail: {
    type: "trail",
    title: "Trail",
    summary: "Bands a stomp launches along the strip.",
    defaultBlend: "over",
    fields: [
      trigger,
      {
        kind: "enum",
        key: "from",
        label: "From",
        options: [
          { value: "down-point", label: "Down point" },
          { value: "down-end", label: "Down end" },
        ],
        default: "down-point",
        help: "Down point launches fronts both ways from where the tilt points along the foot, like rainbow-pool. Down end starts at the toe or heel, whichever is down, and runs both sides to the other end, like fire-stomp.",
      },
      {
        kind: "number",
        key: "flatZone",
        label: "Flat zone",
        min: 0,
        max: 1,
        step: 0.05,
        integer: false,
        default: 0.3,
        shownWhen: { key: "from", value: "down-end" },
        help: "A stomp within this much tilt of flat starts from the middle of each side and runs out to both ends. fire-stomp uses 0.3 of calibrated tilt as its flat zone.",
      },
      { kind: "palette", key: "palette", label: "Palette, head to tail", default: ["#ffffff", "#ffc800", "#ff3c00"] },
      { kind: "knob", key: "speed", label: "Speed", min: 1, max: 400, step: 1, unit: "px/s", default: 45, help: "Read once, when the stomp lands." },
      { kind: "number", key: "length", label: "Length", min: 1, max: 60, step: 1, integer: true, unit: "px", default: 12 },
      brightness({ source: "stompStrength", min: 0.3, max: 1 }),
      {
        kind: "number",
        key: "maxFronts",
        label: "Max fronts",
        min: 1,
        max: 16,
        step: 1,
        integer: true,
        default: 16,
        help: "Fronts that can run at once. Each stomp launches two to four.",
      },
    ],
  },
  flash: {
    type: "flash",
    title: "Flash",
    summary: "The whole strip flashes on a stomp, then fades.",
    defaultBlend: "over",
    fields: [
      { ...trigger, default: "flat" },
      { kind: "palette", key: "palette", label: "Palette, start to end", default: ["#ffffff"] },
      { kind: "number", key: "fadeMs", label: "Fade", min: 50, max: 10000, step: 10, integer: true, unit: "ms", default: 800 },
      brightness(1),
    ],
  },
  sparkle: {
    type: "sparkle",
    title: "Sparkle",
    summary: "Random twinkles that fade out.",
    defaultBlend: "add",
    fields: [
      { kind: "palette", key: "palette", label: "Palette", default: ["#ffffff", "#9fd8ff"] },
      { kind: "knob", key: "density", label: "Density", min: 0, max: 200, step: 1, unit: "/s", default: 12, help: "New sparkles per second, across the whole strip." },
      { kind: "number", key: "fadeMs", label: "Fade", min: 50, max: 10000, step: 10, integer: true, unit: "ms", default: 600 },
      brightness(1),
    ],
  },
  chase: {
    type: "chase",
    title: "Chase",
    summary: "Comets that circle the ring, or run heel to toe.",
    defaultBlend: "over",
    fields: [
      {
        kind: "enum",
        key: "path",
        label: "Path",
        options: [
          { value: "ring", label: "Around the ring" },
          { value: "foot", label: "Heel to toe" },
        ],
        default: "ring",
        help: "Around the ring circles the strip. Heel to toe runs up both sides of the foot at once, then starts again from the heel.",
      },
      { kind: "palette", key: "palette", label: "Palette, head to tail", default: ["#ffffff", "#00c8ff", "#0020ff"] },
      { kind: "number", key: "count", label: "Comets", min: 1, max: 8, step: 1, integer: true, default: 2 },
      {
        kind: "knob",
        key: "speed",
        label: "Speed",
        min: -400,
        max: 400,
        step: 1,
        unit: "px/s",
        default: 60,
        help: "Negative runs the other way: backward around the ring, or toe to heel.",
      },
      { kind: "number", key: "length", label: "Length", min: 1, max: 60, step: 1, integer: true, unit: "px", default: 10 },
      brightness(1),
    ],
  },
  band: {
    type: "band",
    title: "Band",
    summary: "A bar on both sides of the boot, with adjustable width and position.",
    defaultBlend: "multiply",
    fields: [
      {
        kind: "knob",
        key: "position",
        label: "Position",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
        help: "0 rests against the heel, 0.5 centers the bar, and 1 rests against the toe. Moving it keeps the full width on the boot.",
      },
      {
        kind: "knob",
        key: "width",
        label: "Width",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
        help: "The fraction of each side that lights up. 0 is off, 0.5 covers half of each side, and 1 fills the ring. Follow Audio level for a volume bar.",
      },
    ],
  },
};

export const LAYER_TYPES = Object.keys(LAYER_SPECS) as LayerType[];

export const COMMON_FIELDS: Field[] = [
  {
    kind: "enum",
    key: "blend",
    label: "Blend",
    options: [
      { value: "over", label: "Over" },
      { value: "add", label: "Add" },
      { value: "max", label: "Max" },
      { value: "multiply", label: "Multiply" },
    ],
    default: "over",
    help: "Over covers what's below. Add and max brighten it. Multiply shapes it, like pool.",
  },
  opacity,
];

// The fields a layer carries in its file, in file order, after `type`.
export function fieldsFor(type: LayerType): Field[] {
  return [...LAYER_SPECS[type].fields, ...COMMON_FIELDS];
}

// Gives any layer missing a field that field's default, so drafts and files made before the
// field existed still open. Anything it doesn't recognize is left for the validator to report.
export function withDefaults(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { layers?: unknown }).layers)) return value;
  const recipe = value as { layers: unknown[] };
  const layers = recipe.layers.map((layer) => {
    if (typeof layer !== "object" || layer === null) return layer;
    const type = (layer as { type?: unknown }).type;
    if (typeof type !== "string" || !(type in LAYER_SPECS)) return layer;
    const filled: Record<string, unknown> = { ...(layer as Record<string, unknown>) };
    const fresh = newLayer(type as LayerType) as unknown as Record<string, unknown>;
    for (const field of fieldsFor(type as LayerType)) {
      if (filled[field.key] === undefined) filled[field.key] = fresh[field.key];
    }
    return filled;
  });
  return { ...recipe, layers };
}

export function newLayer(type: LayerType): Layer {
  const spec = LAYER_SPECS[type];
  const layer: Record<string, unknown> = { type, enabled: true };
  for (const field of spec.fields) {
    layer[field.key] = cloneDefault(field);
  }
  layer.blend = spec.defaultBlend;
  layer.opacity = 1;
  return layer as unknown as Layer;
}

function cloneDefault(field: Field): unknown {
  if (field.kind === "palette") return [...field.default];
  if (field.kind === "knob" && typeof field.default === "object") return { ...field.default };
  return field.default;
}

// Reads a field by key. Layers are a union, so generic code goes through here.
export function getField(layer: Layer, key: string): unknown {
  return (layer as unknown as Record<string, unknown>)[key];
}

export function withField(layer: Layer, key: string, value: unknown): Layer {
  return { ...layer, [key]: value } as Layer;
}
