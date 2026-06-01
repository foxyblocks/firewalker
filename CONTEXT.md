# Context — Firewalker Shoes

Domain language for this project. Keep terms here precise and reuse them in
code, issues, and docs rather than drifting to synonyms.

## Glossary

- **Firewalker** — the overall wearable: an LED-lit shoe driven by a small
  microcontroller. Named after Adafruit's Firewalker LED-sneakers project.
- **Strip** — one addressable WS2812B LED strip. The firmware currently assumes
  a single strip on one data pin.
- **Pixel** — one addressable RGB LED on the strip (a.k.a. NeoPixel). Each draws
  up to ~60 mA at full white and costs 3 bytes of controller SRAM.
- **DIN** — the strip's data input line. Driven from the controller's data pin
  (Uno pin 6) through a series resistor.
- **Bring-up** — the initial phase (now complete): prove build → upload → data
  line → lit pixels → serial status. "Boring and verifiable."
- **Brightness cap** — the global `setBrightness` ceiling (`LED_BRIGHTNESS`,
  currently 32/255) that keeps total current within the active power budget.
- **Color wipe** — the current animation: lighting pixels one at a time
  bottom→top so the lit region grows until the whole strip is on. **Fill** is
  the color it paints (`FILL_R/G/B`).
- **Stomp** — a trigger event. Currently simulated by a **button** on pin 10
  (`INPUT_PULLUP`); later a real accelerometer step-detect.
- **Debounce** — ignoring contact bounce so one physical press = one trigger
  (`DEBOUNCE_MS`); the read is edge-triggered on press-down.
- **Hold** — the brief pause with the full strip lit at the end of a wipe
  (`HOLD_MS`) before it clears.
- **Power budget** — the current ceiling imposed by the power source (USB vs
  external 5V). Governs the brightness cap and which colors are safe.

## Scope guardrails (current phase)

In scope now: single strip, a button-triggered color wipe (a small non-blocking
state machine), fixed color, fixed brightness, serial status. Still explicitly
**out** of scope: real accelerometer / step detection, multiple strips,
Bluetooth / Wi-Fi, battery management, premature performance work.

## Conventions

- Hardware constants live in `include/config.h`, never hard-coded in `main.cpp`.
- Hardware uncertainty is documented in `docs/`, not buried in code comments.
- Durable decisions are recorded as ADRs under `docs/adr/`.
