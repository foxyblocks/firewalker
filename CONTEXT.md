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
- **Stomp** — a trigger event. Produced by an **FSR** voltage divider on Feather
  A0 (`final_app`/`fsr_debug`), with a D6 debug button kept for bench testing.
  The `imu_debug` mode produces it instead from an **IMU** acceleration spike, as
  a candidate replacement for the FSR.
- **IMU** — the GY-521 / MPU-6050 6-DOF accelerometer + gyroscope read over I2C.
  In `imu_debug` a stomp is a spike in total acceleration magnitude `|a|` above
  the ~9.81 m/s² gravity baseline. See `docs/wiring-mpu6050.md`.
- **Hysteresis** — separate arm/release thresholds so one physical event = one
  trigger even when readings wiggle around the threshold. Used by both the FSR
  (analog) and the IMU (acceleration magnitude).
- **Onboard NeoPixel** — the Feather's built-in single NeoPixel (`PIN_NEOPIXEL`,
  GP16), lit a solid color by `setupCore()` in every mode as a
  power/firmware-running indicator, independent of the main strip and serial
  monitor.
- **Power budget** — the current ceiling imposed by the power source (USB vs
  external 5V). Governs the brightness cap and which colors are safe.

## Scope guardrails (current phase)

In scope now: single strip, stomp-triggered fire trails (a small non-blocking
multi-trail engine), serial status, and **bench evaluation** of an IMU stomp
trigger in `imu_debug`. Still explicitly **out** of scope: wiring the IMU into
`final_app` / production step-detection tuning, multiple strips, Bluetooth /
Wi-Fi, battery management, premature performance work.

## Conventions

- Hardware constants live in `include/config.h`, never hard-coded in the mode or
  core source files.
- Hardware uncertainty is documented in `docs/`, not buried in code comments.
- Durable decisions are recorded as ADRs under `docs/adr/`.
