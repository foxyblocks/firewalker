# Wiring — bring-up rig

Assumptions for the current Arduino Uno R3 + single WS2812B strip setup. These
are **assumptions to verify against the physical build**, not confirmed
measurements — anything uncertain is also tracked in
[`open-questions.md`](open-questions.md).

## Connections

| From (Uno) | To (strip) | Notes |
|---|---|---|
| Digital pin **6** | **DIN** (data in) | Through a **300–470 Ω** series resistor on the data line (Adafruit-recommended; protects the first pixel). |
| **GND** | **GND** | Common ground is **mandatory** — Uno ground and strip ground must be tied together even when the strip has its own supply. |
| **5V** | strip **5V/VCC** | **Bring-up only**, USB-powered, low brightness. Not for full-brightness or many pixels — see below. |

## Button (temporary stomp simulator)

A momentary pushbutton stands in for a foot stomp while we test, before a real
accelerometer is added.

| From (Uno) | To (button) | Notes |
|---|---|---|
| Digital pin **10** | one leg | Uses the AVR **internal pull-up** (`INPUT_PULLUP`) — no external resistor. |
| **GND** | other leg | Pressing connects pin 10 to GND. |

With the internal pull-up, pin 10 reads **HIGH at rest** and **LOW when
pressed** — the firmware debounces (~30 ms) and triggers on the press edge. A
button has no polarity, so "+"/"–" are interchangeable here.

## Recommended protection (Adafruit best practice)

- **Series resistor** (300–470 Ω) on the data line, close to the strip.
- **Large capacitor** (~1000 µF, ≥6.3 V) across the strip's `+`/`–` terminals to
  absorb inrush and protect the LEDs.
- Observe the strip's **data direction arrow** — DIN is the upstream end.

## Power caveat

The Uno's onboard 5V (from USB) is fine for lighting the current 39 pixels
**dimly** during bring-up, but it is **not** a real power plan. For higher
brightness or more pixels, the strip must be powered from a dedicated 5V supply
(with grounds still common). Note the color wipe ends with **all** pixels lit at
once — that full-strip moment is the worst case. See
[`power-budget.md`](power-budget.md).

## Logic level

The Uno is a **5 V** logic board, so its data output drives WS2812 DIN directly —
no level shifter needed *for this rig*. A future 3.3 V controller (e.g. Gemma M0
/ Flora) would need a level shifter or the usual workarounds; tracked as an open
question.
