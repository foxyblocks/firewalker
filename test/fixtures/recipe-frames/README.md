# Recipe reference frames

What the designer's TypeScript engine draws for a fixed script of motion. A test of the firmware's
C++ engine can run the same inputs and compare pixels, with no boot needed.

Everything here except this file is generated from `patterns/` and
`designer/src/engine/referenceFrames.ts`. Don't edit it by hand. After changing what the engine
draws, or a recipe in `patterns/`, regenerate it and commit the result:

```bash
cd designer
bun run reference-frames
```

`bun run test` fails if these files are out of date.

## What's here

| File | Holds |
|---|---|
| `manifest.json` | Every case: its frames file, recipe, and strip layout |
| `inputs.bin` | The motion script, shared by every case |
| `<recipe>--<layout>.bin` | One recipe's expected frames on one strip layout |
| `recipes/*.json` | Small recipes that exercise every layer type, blend, choice, and knob source |

The kept recipes in `patterns/` run on two layouts: `bench` (160 pixels, toe 52, heel 132) and
`3eb5` (107 pixels, toe 72, heel 19). The small recipes run on `3eb5`.

## File formats

Numbers are little-endian.

**`inputs.bin`** is an 8-byte header, then one 12-byte record per frame.

| Offset | Type | Field |
|---|---|---|
| 0 | 4 bytes | `FWRI` |
| 4 | `uint16` | File format, 1 |
| 6 | `uint16` | Frame count |

| Record offset | Type | Field |
|---|---|---|
| 0 | `float32` | Tilt, -1 to 1. Exactly 0 in the dead zone |
| 4 | `float32` | Stomp strength, 0 to 1 |
| 8 | `uint16` | Time since the previous frame, in ms |
| 10 | `uint8` | 1 if a stomp fired on this frame |
| 11 | `uint8` | Unused, 0 |

**`<recipe>--<layout>.bin`** is a 16-byte header, then the saved frames.

| Offset | Type | Field |
|---|---|---|
| 0 | 4 bytes | `FWRF` |
| 4 | `uint16` | File format, 1 |
| 6 | `uint16` | Pixel count |
| 8 | `uint16` | Toe pixel |
| 10 | `uint16` | Heel pixel |
| 12 | `uint16` | N: a frame is saved after every N updates |
| 14 | `uint16` | Saved frame count |

Each saved frame is R, G, B bytes for each pixel in strip order, as `floor(value × 255 + 0.5)`,
before the boot's brightness setting. The first saved frame comes after N updates. The engine still
runs every frame in between, so a difference in how state builds up shows at the next saved frame.

## Using them

Start the engine fresh on the case's layout, as a boot does when it switches to a pattern. Then feed
it every record in `inputs.bin` in order, and compare at each saved frame.

C++ does its math differently from JavaScript in small ways, so allow a difference of 1 per channel.
