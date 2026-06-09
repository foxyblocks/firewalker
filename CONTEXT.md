# Context — Firewalker Shoes

Domain language for this project. Keep terms here precise and reuse them in
code, issues, and docs rather than drifting to synonyms.

## Glossary

- **Firewalker** — the overall wearable: an LED-lit shoe driven by a small
  microcontroller. Named after Adafruit's Firewalker LED-sneakers project.
- **Mode** — a *compile-time* build variant selected by `platformio.ini` build
  flags and dispatched in `include/modes/mode_select.h` (`final_app`,
  `imu_debug`). Distinguishes which **build** is compiled — the app vs. the
  IMU sensor-debug build. Do **not** use "mode" for a visual behavior — that's a
  **Pattern**.
- **Pattern** — a *runtime-selectable* visual behavior of the strip (e.g.
  **fire-trail**, **flow**). One firmware holds the active pattern and can switch
  between them live (the D6 button cycles patterns). _Avoid_: "light mode",
  "animation mode".
- **Fire-trail** — the Pattern where each **stomp** spawns a **trail** (a fire
  gradient band) that climbs the strip; several stack at once.
- **Flow** — the Pattern where the strip shares one hue that slowly rotates
  through the spectrum and "pools": brightness ramps toward whichever end tilts
  down, tracking the shoe's **orientation**. A **stomp** launches **trail**
  fronts from the tilt-derived "down" point — up to 4 bands (2 per side)
  diverging to the heel and toe ends, each a white head → current hue → previous
  hue.
- **Strip** — one addressable WS2812B LED strip (39 pixels, single data pin).
  Routed as a **loop** around the foot: it starts at the heel, runs to the toe up
  one side, wraps the toe, and returns to the heel down the other side — so the
  **toe sits at the middle index and the heel is at both ends** (indices 0 and
  38). Index order is *not* the heel→toe axis; flow maps each pixel to its real
  fore-aft foot position (the **toe-apex** index is a measured constant).
- **Pixel** — one addressable RGB LED on the strip (a.k.a. NeoPixel). Each draws
  up to ~60 mA at full white and costs 3 bytes of controller SRAM.
- **DIN** — the strip's data input line. Driven from the controller's data pin
  (Feather D5). The current minimal rig uses direct data wiring; the
  extra-effort reference adds a resistor and level shifter.
- **Bring-up** — the initial phase (now complete): prove build → upload → data
  line → lit pixels → serial status. "Boring and verifiable."
- **Brightness** — the global `setBrightness` level (`LED_BRIGHTNESS`). Trades
  visibility against current draw; see the power budget.
- **Trail** — a band of `TRAIL_LEN` pixels spawned by a stomp that travels
  bottom→top, **wiping in** at the bottom and **out** at the top (no hold).
  Several run at once (`MAX_TRAILS`), each behind the previous.
- **Fire gradient** — a trail's color ramp: a hot head cooling through the
  `FIRE[]` stops to a red tail, precomputed once per `TRAIL_LEN`.
- **Stomp** — a trigger event: a foot impact. Detected from an **IMU**
  acceleration spike, with a D6 debug button kept for bench testing.
- **IMU** — the GY-521 / MPU-6050 6-DOF accelerometer + gyroscope read over I2C,
  the shoe's motion sensor. A stomp is a spike in total acceleration magnitude
  `|a|` above the ~9.81 m/s² gravity baseline. See `docs/wiring-mpu6050.md`.
- **Orientation** — the shoe's tilt relative to gravity, estimated by fusing the
  accelerometer (absolute "down") with the gyroscope (rotation rate) in a
  complementary filter. Drives the **flow** Pattern. _Avoid_: "gyro angle"
  (the gyro alone can't give absolute tilt).
- **Hysteresis** — separate arm/release thresholds so one physical event = one
  trigger even when readings wiggle around the threshold (used for IMU stomp
  detection).
- **Onboard NeoPixel** — the Feather's built-in single NeoPixel (`PIN_NEOPIXEL`,
  GP16), lit a solid color by `setupCore()` in every mode as a
  power/firmware-running indicator, independent of the main strip and serial
  monitor.
- **Power budget** — the current ceiling imposed by the power source (USB vs
  external 5V). Governs the brightness cap and which colors are safe.

## Scope guardrails (current phase)

In scope now: single strip; the **IMU** as the sole stomp sensor (FSR retired);
runtime-switchable **patterns** (`flow` + `fire-trail`) on the app, plus the
`imu_debug` sensor build; serial status. Still explicitly **out** of scope: the
2-D "perimeter bubble" flow (roll as well as pitch), multiple strips, Bluetooth /
Wi-Fi, battery management, the wearable power plan, premature performance work.

## Conventions

- Hardware constants live in `include/config.h`, never hard-coded in the mode or
  core source files.
- Hardware uncertainty is documented in `docs/`, not buried in code comments.
- Durable decisions are recorded as ADRs under `docs/adr/`.
