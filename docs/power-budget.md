# Power budget (USB)

Why current — not memory — is the ceiling on this rig, and how the fire trails
fit under it.

## The numbers

- A WS2812 pixel draws ≈ **20 mA per channel** at full value, so ≈ **60 mA** at
  full white, plus ~1 mA quiescent.
- The library applies the global brightness, so per-pixel current ≈
  `Σchannels × 20 mA × (channel / 255) × (LED_BRIGHTNESS / 255)`.
- A USB 2.0 port supplies ~**500 mA**. The current rig feeds the strip from the
  Feather USB/VBUS pin, so the Feather and strip share that budget.

## Worst case = the whole strip lit

Trails stack (`MAX_TRAILS`), so enough overlapping bands can light all 39 px at
once. That full-strip instant is the worst case — current scales with
**brightness × pixels lit × how many channels the color uses**.

The fire palette is all `R = 255` with falling `G` and `B = 0`, so each pixel
uses ~1–1.8 channels — cheaper than white. Rough per-pixel and 39-px totals:

| Brightness | Fire pixel (~1.4 ch avg) | 39 px (fire) | 39 px (white, 3 ch) |
|---|---|---|---|
| `32` | ~4 mA | ~160 mA | ~330 mA |
| `100` (current) | ~12 mA | **~470 mA** | ~950 mA |

So at the current `LED_BRIGHTNESS = 100`, a strip full of fire pixels (~470 mA)
sits **right at the practical USB budget** — heavy trigger-mashing can brown out
or flicker. A single `TRAIL_LEN = 30` band is ~360 mA (under, but not by much).
White at this brightness is far over — which is why the palette avoids it.

## Levers to stay safe on USB

- Lower `LED_BRIGHTNESS`, shorten `TRAIL_LEN`, or drop `MAX_TRAILS`.
- Keep colors off pure white (the palette already does).
- Estimate before bumping anything: `pixels_lit × per-pixel mA` under the
  power source's real current budget.

## Before going brighter / longer

Move the strip to a **dedicated 5V supply** sized for the real worst case
(`pixels × 60 mA` for white), keep grounds common, and power it **directly** —
never through the Feather's 3V3 regulator. This is an
[open question](open-questions.md) for the final wearable.
