# Pattern recipe format, version 1

A **recipe** describes a pattern as data: a stack of layers that each paint the strip, with
knobs that can follow tilt, stomps, time, and audio. The designer (`designer/`) makes and
previews recipes, and `patterns/` keeps the ones worth keeping. The firmware doesn't run
recipes yet; that's the next phase (see [ADR-0005](adr/0005-pattern-recipes.md)).

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
| `version` | `1`. A reader refuses versions it doesn't know |
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
speeds up with sound. Stopping capture returns to `min`. Audio input on the boots needs
firmware microphone support.

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
