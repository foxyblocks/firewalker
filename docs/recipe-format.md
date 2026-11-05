# Pattern recipe format, versions 1 and 2

A **recipe** describes a pattern as data: a stack of layers that each paint the strip, with
knobs that can follow tilt, stomps, time, and audio. The designer (`designer/`) makes and
previews recipes, and `patterns/` keeps the ones worth keeping. A boot runs them in a compiled
form, [below](#compiled-form), either built into its firmware or uploaded (see
[ADR-0005](adr/0005-pattern-recipes.md)).

This page is the contract between the two. The designer's code is the reference:
`designer/src/recipe/spec.ts` holds every range and default, `validate.ts` checks a file,
and `designer/src/engine/engine.ts` shows what each layer draws.

## A file

```json
{
  "format": "firewalker-recipe",
  "version": 1,
  "name": "lava-pour",
  "description": "Molten colors crawl around the ring and pour toward whichever end is down.",
  "layers": [
    { "type": "fill", "enabled": true, "palette": ["#ff2000", "#ffd000"], "...": "..." },
    { "type": "pool", "enabled": true, "baseline": 0.25, "blend": "multiply", "opacity": 1 }
  ]
}
```

| Field | Rule |
| --- | --- |
| `format` | Always `firewalker-recipe` |
| `version` | `1` for the original layers and sources, `2` for Band or audio. New firmware reads both |
| `name` | 1 to 12 characters: a lowercase letter, then `a-z`, `0-9`, or `-`. Not `off`, `flow`, or `fire-trail`, which the boot already uses. The boot lists patterns by this name, and the file is `patterns/<name>.json` |
| `description` | Up to 200 characters, for people. The boot never sees it |
| `layers` | 1 to 8 layers, drawn first to last, so the last one is on top |

A file with an unknown field, or a value out of range, is invalid as a whole. That keeps a
typo from turning into a silent default. The designer does fill in a field that's missing
entirely with its default when it opens a draft or imports a file, so recipes made before a
field existed still open.

Saved files list fields in a fixed order, two-space indented, with each palette and each
binding on one line, so they diff cleanly.

## Every layer

| Field | Values | Default |
| --- | --- | --- |
| `type` | `fill`, `pool`, `trail`, `flash`, `sparkle`, `chase`, `band` | |
| `label` | Optional, up to 24 characters, for the layer list | |
| `enabled` | `true` or `false`. A disabled layer draws nothing | `true` |
| `blend` | `over`, `add`, `max`, `multiply` | per type |
| `opacity` | 0 to 1, knob | 1 |

## Knobs

Most numbers are **knobs**: either a plain number, or a **binding** that follows a source
between `min` and `max`.

```json
"brightness": { "source": "stompFade", "min": 0.2, "max": 1, "fadeMs": 600 }
```

| Source | Gives `min` | Gives `max` |
| --- | --- | --- |
| `tilt` | At the heel pose (halfway when flat) | At the toe pose |
| `tiltAmount` | Flat | Full tilt either way |
| `stompStrength` | A threshold stomp, held until the next one | A full-force stomp |
| `stompFade` | `fadeMs` (50 to 10000, default 1000) after a stomp | At the stomp |
| `wave` | Low point of a smooth loop | High point, every `periodMs` (100 to 60000, default 2000) |
| `audioLevel` | Silence, or audio capture stopped | Full level on the simulator's audio meter |

In the simulator, choose Microphone or Computer audio above the boot and click Listen.
Every audio-bound knob follows the same live level shown by the meter. Its `min` and `max`
set the output range, so brightness from 0 to 1 fades with sound, or speed from 20 to 200
speeds up with sound. Stopping capture returns to `min`. The C++ engine accepts the same normalized input through `PatternInput.audioLevel`. The
application supplies silence until the MG24 microphone capture is connected and checked on a boot.

`min` and `max` stay inside the knob's own range. `min` can be larger than `max`, which runs
the binding backward. `periodMs` is only allowed on `wave`, and `fadeMs` only on `stompFade`.

## Layer types

Palettes are 1 to 16 `#rrggbb` colors, lowercase. A fill's palette loops, so its last color
blends back into the first. Every other layer reads its palette once from start to end.

A trigger of `flat` fires on a stomp while tilt reads exactly 0, which is the firmware's
dead zone near level. `tilted` fires on any other stomp, and `any` on both.

### `fill`

Colors the whole strip from a looping palette. Default blend: `over`.

| Field | Values | Default |
| --- | --- | --- |
| `palette` | 1 to 16 colors | `#ff0000 #ffff00 #00ff00 #00ffff #0000ff #ff00ff` |
| `spread` | `solid` (one color at a time), `ring` (along the strip in index order), `foot` (heel to toe) | `solid` |
| `repeat` | 0.1 to 8, knob. How many times the palette loops across the spread | 1 |
| `offset` | 0 to 1, knob. Where in the palette to start | 0 |
| `scroll` | -4 to 4 loops/s, knob | 0.0667 |
| `brightness` | 0 to 1, knob | 1 |

### `pool`

Flow's tilt gauge. Flat, every pixel sits at `baseline`. As the boot tilts, light drains
from the up end, and the pixels left brighten toward full, down to one pixel at the down end
at full tilt. It paints gray, so use it with `multiply` to shape the layers below.

| Field | Values | Default |
| --- | --- | --- |
| `baseline` | 0 to 1, knob | 0.8 |

### `band`

A gray mask over the same heel-to-toe interval on both sides of the boot. Use `multiply`
above a fill to turn it into a bar. Its edges fade across one pixel as they move.

| Field | Values | Default |
| --- | --- | --- |
| `position` | 0 to 1, knob. Heel at 0, centered at 0.5, toe at 1 | 0.5 |
| `width` | 0 to 1, knob. Fraction of each side covered by the bar | 0.5 |

Position slides the whole band while preserving its width. At width 0.5, flat lights the
middle half of both sides, heel-down lights heel to midpoint, and toe-down lights midpoint
to toe. Width 0 clears the ring, and width 1 lights every pixel, at any tilt.

`bass-ripple` binds position to `tilt` and width to `audioLevel`, over a rainbow fill whose
brightness follows `stompFade` from 0.7 to 1 with a 200 ms fade. Stomps brighten the current
bar. At zero volume the ring stays dark, including during a stomp.

### `trail`

Bands a stomp launches along the strip. Default blend: `over`.

| Field | Values | Default |
| --- | --- | --- |
| `trigger` | `any`, `flat`, `tilted` | `any` |
| `from` | `down-point` or `down-end`, below | `down-point` |
| `flatZone` | 0 to 1. For `down-end`, tilt this close to flat counts as flat | 0.3 |
| `palette` | 1 to 16 colors, head to tail | `#ffffff #ffc800 #ff3c00` |
| `speed` | 1 to 400 px/s, knob, read once when the stomp lands | 45 |
| `length` | 1 to 60 px | 12 |
| `brightness` | 0 to 1, knob, read once when the stomp lands | `stompStrength` 0.3 to 1 |
| `maxFronts` | 1 to 16 fronts running at once. Further stomps wait for a free one | 16 |

- **`down-point`** is flow's trail. Each side of the foot gets a source at the point the
  tilt picks, from the heel at full heel down to the toe at full toe down, and sends a front
  each way. Fronts stop at the toe and heel.
- **`down-end`** is fire-trail's. Toe down sends one front up each side from the toe to the
  heel, heel down does the reverse, and flat sends four fronts out from the middle of each
  side. fire-trail counts 8° from level as flat. A recipe sees tilt, not degrees, so
  `flatZone` sets it instead.

Bands wipe in where they start and out where they end.

### `flash`

The whole strip flashes on a stomp, then fades. Its color runs through the palette as it
fades. Default blend: `over`.

| Field | Values | Default |
| --- | --- | --- |
| `trigger` | `any`, `flat`, `tilted` | `flat` |
| `palette` | 1 to 16 colors, start to end | `#ffffff` |
| `fadeMs` | 50 to 10000 ms | 800 |
| `brightness` | 0 to 1, knob, read once when the stomp lands | 1 |

### `sparkle`

Random pixels light up and fade out, each one a random color from the palette. Default
blend: `add`.

| Field | Values | Default |
| --- | --- | --- |
| `palette` | 1 to 16 colors | `#ffffff #9fd8ff` |
| `density` | 0 to 200 new sparkles a second across the strip, knob | 12 |
| `fadeMs` | 50 to 10000 ms | 600 |
| `brightness` | 0 to 1, knob | 1 |

### `chase`

Comets, spaced evenly, head to tail through the palette. Default blend: `over`.

| Field | Values | Default |
| --- | --- | --- |
| `path` | `ring` circles the strip. `foot` runs up both sides of the foot at once, heel to toe, and starts again from the heel once the tail has left the toe | `ring` |
| `palette` | 1 to 16 colors, head to tail | `#ffffff #00c8ff #0020ff` |
| `count` | 1 to 8 | 2 |
| `speed` | -400 to 400 px/s, knob. Negative runs the other way: toward lower indices on `ring`, toe to heel on `foot` | 60 |
| `length` | 1 to 60 px | 10 |
| `brightness` | 0 to 1, knob | 1 |

## Drawing a frame

Every 16 ms, each enabled layer paints a color and a coverage for every pixel, and the
layer goes onto what's below it at `a` = coverage × `opacity`:

| Blend | Result |
| --- | --- |
| `over` | below + (color − below) × a |
| `add` | below + color × a, capped at full |
| `max` | the brighter of below and color × a, per channel |
| `multiply` | below × (1 − a + color × a) |

The strip starts each frame black. Colors are linear LED drive levels from 0 to 1, before the
boot's own brightness setting scales them. Positions along the foot use the boot's saved
strip layout, the same map as `include/firewalker_strip_map.h`, so a recipe looks right on
any boot's ring.

## Compiled form

A boot never reads JSON. `designer/src/recipe/compile.ts` turns a recipe into this binary, and
`include/firewalker_recipe.h` reads it. The two are checked against each other using the test recipes in
`test/fixtures/recipe-frames/`.

A compiled recipe is at most **254 bytes**, because that's the largest entry the boot's flash store holds,
and one entry saves all at once. The designer shows the size, and won't save or send a recipe over it.
Compiling drops what a boot has no use for: the description, labels, and disabled layers. A recipe needs at
least one enabled layer.

Numbers are little-endian. The compiler uses the earliest version needed by the enabled layers.
Version 1 recipes keep their existing bytes. Version 2 appends Band (type 6) and audioLevel
(source 5), preserving every version 1 field and code. New firmware decodes and lists both versions.
An older boot that only lists version 1 gets a firmware-update message before an audio recipe is sent.

Saving JSON upgrades earlier audio drafts to version 2. If an audio layer is disabled, it is
omitted from the compiled recipe, so an otherwise version 1 effect can still go to an older boot.
Both decoders reject a version 1 binary that tries to use a version 2 layer or source.

| Bytes | Recipe |
|---|---|
| 1 | `version` |
| 1 | Name length, 1 to 12 |
| 1 to 12 | Name, ASCII |
| 1 | Layer count, 1 to 8 |
| varies | Layers, first drawn first |
| 4 | CRC-32 of everything before it |

| Bytes | Layer |
|---|---|
| 1 | Type: fill 0, pool 1, trail 2, flash 3, sparkle 4, chase 5, band 6 (version 2) |
| 1 | Bound-knob mask. Bit k set means the layer's k-th knob is a binding |
| varies | Its fields, in the order below |

| Type | Fields in order (knobs marked \*) |
|---|---|
| fill | palette, spread, repeat\*, offset\*, scroll\*, brightness\*, blend, opacity\* |
| pool | baseline\*, blend, opacity\* |
| trail | trigger, from, flatZone, palette, speed\*, length, brightness\*, maxFronts, blend, opacity\* |
| flash | trigger, palette, fadeMs, brightness\*, blend, opacity\* |
| sparkle | palette, density\*, fadeMs, brightness\*, blend, opacity\* |
| chase | path, palette, count, speed\*, length, brightness\*, blend, opacity\* |
| band | position\*, width\*, blend, opacity\* |

| Field | Bytes | Encoding |
|---|---|---|
| A choice, such as `spread` or `blend` | 1 | The option's place in its list above |
| `length`, `fadeMs`, `count`, `maxFronts` | 2 | `uint16` |
| `flatZone` | 2 | Scaled |
| Palette | 1 + 3n | Color count, then R, G, B per color |
| Fixed knob | 2 | Scaled |
| Bound knob | 5 or 7 | Source (tilt 0, tiltAmount 1, stompStrength 2, stompFade 3, wave 4, audioLevel 5 in version 2), scaled `min`, scaled `max`, and for `wave` or `stompFade`, a `uint16` for `periodMs` or `fadeMs` |

A **scaled** number is an `int16` across the field's range. With `range` as the larger of the field's `|min|`
and `|max|`, it's stored as `round(value / range × 32767)` and read as `raw / 32767 × range` in single
precision, limited to the field's `min` and `max`. A speed of 60 on a field from -400 to 400 is stored as 4915
and reads as 59.9994.

A boot checks everything it reads, because anyone in Bluetooth range can send one. It refuses a wrong version,
a bad checksum, a bad or reserved name, an unknown type, option, or source, a bad palette size, and data that
ends early or runs long.
