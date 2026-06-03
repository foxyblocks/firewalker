# Wiring — Feather RP2040 rig

Assumptions for the current Adafruit Feather RP2040 + single WS2812B strip
setup. These are **assumptions to verify against the physical build**, not
confirmed measurements — anything uncertain is also tracked in
[`open-questions.md`](open-questions.md).

## Connections

| From (Feather RP2040) | To (strip) | Notes |
|---|---|---|
| **D5** | **DIN** (data in) | Direct data wire. In the installed board variant, D5 maps to GPIO 7. |
| **GND** | **GND** | Common ground is **mandatory**: Feather ground and strip ground must be tied together even when the strip has its own supply. |
| **USB** | strip **5V/VCC** | The Feather's USB power-out/VBUS pin feeds the strip for the current low-brightness test rig. |

## Button (temporary stomp simulator)

A momentary pushbutton stands in for a foot stomp while we test, before a real
accelerometer is added.

| From (Feather RP2040) | To (button) | Notes |
|---|---|---|
| **D6** | one leg | Uses the internal pull-up (`INPUT_PULLUP`) — no external resistor. In the installed board variant, D6 maps to GPIO 8. |
| **GND** | other leg | Pressing connects D6 to GND. |

With the internal pull-up, D6 reads **HIGH at rest** and **LOW when pressed**.
The firmware debounces (~30 ms) and triggers on the press edge. A button has no
polarity, so "+"/"-" are interchangeable here.

## Extra-effort reference

The current working rig intentionally omits the level shifter, data-line
resistor, and bulk capacitor. If the strip becomes flaky, gets longer/brighter,
or moves from bench testing to wearable use, use
[`wiring-extra-effort.html`](wiring-extra-effort.html) as the reference for the
more protective wiring: 74AHCT125 level shifter, 300-470 ohm data resistor, and
bulk capacitor across strip power.

Always observe the strip's **data direction arrow** — DIN is the upstream end.

## Power caveat

The Feather's USB/VBUS 5V is fine for lighting the current 39 pixels **dimly**
during bring-up, and this is the wiring currently confirmed working. It is
still not a real power plan for higher brightness or more pixels. Note that
stacked trails can light the whole strip at once; that full-strip moment is the
worst case. See [`power-budget.md`](power-budget.md).

## Logic level

The Feather RP2040 is a **3.3 V** logic board. This strip is currently working
with direct 3.3V data into a 5V-powered WS2812 strip. If the strip glitches or
fails to respond reliably, the first upgrade is a 74AHCT125 or similar
5V-powered level shifter as shown in the extra-effort reference.
