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
  through the spectrum and "pools": at level it glows a flat dim baseline, and
  as the foot tilts brightness drains from the up-end and concentrates into a
  tight pool at whichever end tilts down, tracking the shoe's **orientation**.
  A **stomp** launches **trail**
  fronts from the tilt-derived "down" point — up to 4 bands (2 per arc of the
  strip ring) diverging to the heel and toe, each a white head → current hue →
  previous hue.
- **Strip** — one addressable WS2812B LED strip (exactly 40 pixels, single data
  pin). Routed as a closed **ring** around the foot perimeter: pixel 0 starts at
  the **inner ankle** directly under the controller, runs forward along the
  inner side to the **toe apex** (index 13), back along the outer side to the
  **heel** (index 33), and returns to the start. Both toe↔heel arcs are exactly
  20 steps. Index order is *not* the heel→toe axis; the pure map in
  `include/firewalker_strip_map.h` gives each pixel its fore-aft foot position
  (toe/heel indices are measured constants `STRIP_TOE_INDEX` /
  `STRIP_HEEL_INDEX`).
- **Foot side** — which shoe (left/right) a firmware build targets. Both shoes
  carry an identical hardware build on the inner ankle, so the side is purely a
  compile-time flag (`FIREWALKER_FOOT_LEFT`/`_RIGHT`, envs `final_app_left` /
  `final_app_right`, default right) that flips the chirality-sensitive IMU
  mount signs (fore-aft accel, pitch gyro). Distinct from a **Mode** (which
  build is compiled) and a **Pattern** (runtime visual).
- **Pixel** — one addressable RGB LED on the strip (a.k.a. NeoPixel). Each draws
  up to ~60 mA at full white and costs 3 bytes of controller SRAM.
- **DIN** — the strip's data input line. Driven from the controller's data pin
  (Feather D5). The current minimal rig uses direct data wiring; the
  extra-effort reference adds a resistor and level shifter.
- **Bring-up** — the initial phase (now complete): prove build → upload → data
  line → lit pixels → serial status. "Boring and verifiable."
- **Brightness** — the global `setBrightness` level (`LED_BRIGHTNESS`). Trades
  visibility against current draw; see the power budget.
- **Trail** — a band of `FIRE_TRAIL_LEN` pixels spawned by a stomp that travels
  bottom→top, **wiping in** at the bottom and **out** at the top (no hold).
  Several run at once (`FIRE_TRAIL_MAX`), each behind the previous.
- **Fire gradient** — a trail's color ramp: a hot head cooling through the
  `FIRE[]` stops to a red tail, precomputed once per `FIRE_TRAIL_LEN`.
- **Stomp** — a trigger event: a foot impact. Detected from an **IMU**
  acceleration spike, with a D6 debug button kept for bench testing.
- **IMU** — the GY-521 / MPU-6050 6-DOF accelerometer + gyroscope read over I2C,
  the shoe's motion sensor. A stomp is a spike in total acceleration magnitude
  `|a|` above the ~9.81 m/s² gravity baseline. See `docs/wiring-mpu6050.md`.
- **Orientation** — the shoe's tilt relative to gravity, estimated by fusing the
  accelerometer (absolute "down") with the gyroscope (rotation rate) in a
  complementary filter. Drives the **flow** Pattern. In code this is the
  fore-aft **tilt** (`imuTiltFwd()`, `tiltFwd`, `IMU_TILT_*` — "tilt" is the
  code spelling of Orientation's fore-aft component). The pure fusion math
  lives in `include/firewalker_fusion.h` and is tested off-hardware
  (`pio test -e native`). _Avoid_: "gyro angle" (the gyro alone can't give
  absolute tilt).
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
