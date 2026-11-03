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

## FSR (temporary stomp simulator)

An FSR stands in for a foot stomp while we test, before any real accelerometer
or shoe-mounted trigger is added. The Feather reads the FSR through a voltage
divider on analog input A0.

| From | To | Notes |
|---|---|---|
| **3V3** | one FSR leg | Powers the divider from Feather logic voltage. |
| other FSR leg | **A0** | Analog sense point. In the installed board variant, A0 reads as GPIO 26. |
| **A0** | fixed resistor to **GND** | Start with **10k ohm**. Larger values make lighter pressure more visible; smaller values favor heavier pressure. |

Pressing the FSR lowers its resistance, so this divider makes the A0 reading
rise. The observed baseline is roughly 100-300, and a hard press reads around
700-1000. The firmware fires once when the reading rises above
`FSR_STOMP_THRESHOLD`, then waits until it falls below `FSR_RELEASE_THRESHOLD`
before arming again. This hysteresis keeps one foot press from spawning repeated
trails.

## Debug button

The D6 button remains enabled as a bench-test trigger. It spawns the same trail
as an FSR stomp, but it is digital and deterministic while the FSR threshold is
being tuned.

| From (Feather RP2040) | To (button) | Notes |
|---|---|---|
| **D6** | one leg | Uses the internal pull-up (`INPUT_PULLUP`) — no external resistor. In the installed board variant, D6 maps to GPIO 8. |
| **GND** | other leg | Pressing connects D6 to GND. |

## Extra-effort reference

The current working rig intentionally omits the level shifter, data-line
resistor, and bulk capacitor. If the strip becomes flaky, gets longer/brighter,
or moves from bench testing to wearable use, use
[`wiring-extra-effort.html`](wiring-extra-effort.html) as the reference for the
more protective wiring: 74AHCT125 level shifter, 300-470 ohm data resistor, and
bulk capacitor across strip power.

Always observe the strip's **data direction arrow** — DIN is the upstream end.

## Power caveat

The Feather's USB/VBUS 5V is fine for lighting the 40 pixels **dimly**
during bring-up, and this is the wiring currently confirmed working. It is
still not a real power plan for higher brightness or more pixels. Note that
stacked trails can light the whole strip at once; that full-strip moment is the
worst case. See [`power-budget.md`](power-budget.md).

## Logic level

The Feather RP2040 is a **3.3 V** logic board. This strip is currently working
with direct 3.3V data into a 5V-powered WS2812 strip. If the strip glitches or
fails to respond reliably, the first upgrade is a 74AHCT125 or similar
5V-powered level shifter as shown in the extra-effort reference.
