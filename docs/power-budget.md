# Power budget — bring-up (USB)

Why brightness is capped at `32/255` and the wipe's fill is **not** white.

## The numbers

- A WS2812 pixel draws ≈ **20 mA per channel** at full value, so ≈ **60 mA** at
  full white, plus ~1 mA quiescent.
- The library applies the global brightness, so effective per-channel current ≈
  `20 mA × (channel_value / 255) × (LED_BRIGHTNESS / 255)`.
- A USB 2.0 port supplies ~**500 mA**. The Uno + regulator eat ~30–50 mA, leaving
  roughly **450 mA** for LEDs — and the Uno's 5V trace shouldn't be pushed hard
  regardless.

## 39 pixels (full strip) at `LED_BRIGHTNESS = 32`

The color wipe ends with **all 39 pixels lit at once** — that full-strip instant
is the worst case, not the moving phase.

| Fill | Per-pixel (approx) | 39 pixels | Verdict on USB |
|---|---|---|---|
| Amber `(255, 60, 0)` — current default | ~4 mA | **~160 mA** | ✅ safe |
| Single full channel `(255, 0, 0)` | ~3.5 mA | ~140 mA | ✅ safe |
| **White `(255, 255, 255)`** | ~8.5 mA | **~330 mA** | ⚠️ within budget but high |

At 39 px, white (~330 mA) no longer *exceeds* the ~450 mA budget the way 60 px
did, but it's still the worst case and pushes the Uno's 5V trace harder than is
wise. The default fill deliberately uses one dominant channel, and the cap stays
low.

## Rules of thumb (this phase)

- Keep `LED_BRIGHTNESS ≤ 32` while USB-powered.
- Avoid white / near-white fills on USB.
- Estimate before raising anything: `pixels × per-pixel mA` must stay under
  ~450 mA on USB.

## Before going brighter / longer

Move the strip to a **dedicated 5V supply** sized for the real worst case
(`pixels × 60 mA` for white), keep grounds common, and only then raise the cap.
This is an [open question](open-questions.md) for the final wearable.
