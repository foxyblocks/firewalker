# Firewalker Shoes

Wearable LED-shoe firmware, inspired by Adafruit's Gemma LED Sneakers /
Firewalker guide. Built with **PlatformIO + Arduino framework** in VS Code (not
the Arduino IDE).

> **Status:** IMU-driven, runtime light **patterns** on the Feather RP2040 rig,
> across **39 pixels** of one WS2812B strip. A GY-521 / MPU-6050 (accel + gyro,
> I2C) is the motion sensor. The app runs two patterns and **D6 cycles** between
> them (boots into `flow`):
>
> - **flow** — the strip shares one hue that slowly rotates through the spectrum
>   and "pools": brightness ramps toward whichever end of the foot tilts down
>   (the strip loops heel→toe→heel, so the toe is mid-strip). A **stomp**
>   (acceleration spike) launches trail fronts from the down-point — up to 4
>   bands diverging around each side to the heel and toe, a white head fading
>   through the current hue to the previous one.
> - **fire-trail** — each stomp launches a fire-gradient band that climbs the
>   strip; several stack at once.
>
> The onboard NeoPixel lights solid in every mode as a power indicator. The FSR
> is retired ([ADR-0002](docs/adr/0002-runtime-patterns-imu-default.md)); no
> wireless yet.

## Hardware

| | |
|---|---|
| Board | Adafruit Feather RP2040 |
| LED strip | WS2812B, `NEO_GRB` + 800 KHz |
| Data pin | Feather **D5** → strip DIN (direct, no level shifter on current rig) |
| Pixels driven | 39 (strip loops heel→toe→heel) |
| Motion sensor | GY-521 / MPU-6050 over I2C (**SDA**/**SCL**, 3V3) |
| Pattern cycle | Momentary button from Feather **D6** → GND (`INPUT_PULLUP`) |
| Status light | Onboard **NeoPixel** (GP16), lit solid in every mode |
| Power | Feather **USB/VBUS** → strip 5V, common ground — current scales with brightness × pixels lit (see [`docs/power-budget.md`](docs/power-budget.md)) |

See [`docs/wiring-mpu6050.html`](docs/wiring-mpu6050.html) for the IMU wiring,
[`docs/wiring.md`](docs/wiring.md) for the base strip/button wiring,
[`docs/wiring-extra-effort.html`](docs/wiring-extra-effort.html) for the
level-shifter/resistor reference, and
[`docs/open-questions.md`](docs/open-questions.md) for unresolved hardware
decisions and the bench-calibration checklist.

## Quick start

```bash
# Build the default app (flow + fire-trail patterns)
pio run

# Upload the app to a connected Feather RP2040
pio run -e final_app -t upload

# Upload the IMU bench/calibration build
pio run -e imu_debug -t upload

# Watch serial output for the active build (115200 baud)
pio device monitor -e imu_debug
```

Expected app serial output (boots into `flow`; D6 cycles patterns):

```
[firewalker] mode=final_app
[firewalker] pixels=39 led pin=7 button pin=8
[firewalker] mpu6050 ready @0x68
[firewalker] imu stomp |a|>=18.00 release<=12.00 tilt axis(accel fwd=0 up=1 gyro=2)
[firewalker] pattern -> flow
[firewalker] pattern -> fire-trail
```

In the app, `flow` cycles one hue slowly through the spectrum and pools brightness
toward the down-end as you tilt the shoe; a stomp (a sharp acceleration spike)
launches diverging trail fronts from the down-point. Press **D6** to switch to
`fire-trail`, where each stomp launches a climbing fire band. With no IMU
connected the strip still shows `flow`'s flat baseline (no tilt, no stomps).

### Calibrating with `imu_debug`

`imu_debug` logs the raw accel/gyro, the fused tilt, and stomp events, and mirrors
tilt as strip brightness — so you can confirm the axis mapping by eye and set the
`FLOW_*` axes/signs and stomp thresholds in `include/config.h` (see the checklist
in [`docs/open-questions.md`](docs/open-questions.md)).

```
[firewalker] mode=imu_debug
[firewalker] pixels=39 led pin=7 button pin=8
[firewalker] mpu6050 ready @0x68
[firewalker] imu stomp |a|>=18.00 release<=12.00 tilt axis(accel fwd=0 up=1 gyro=2)
[firewalker] imu a=(0.12,-0.34,9.79) |a|=9.80 g=(0.01,0.00,-0.02) tilt=0.04 armed=true
[firewalker] imu stomp
...
```

## ⚠️ Power safety

Current scales with **brightness × pixels lit**. `flow` is magenta (a 2-channel
color), so at `LED_BRIGHTNESS = 100` a near-level stomp can momentarily light the
whole strip ~612 mA — over the USB budget (a known, accepted brownout risk for
the bench demo). Before running brighter/longer, read
[`docs/power-budget.md`](docs/power-budget.md) and use a dedicated 5V strip
supply with grounds tied together.

## Project conventions

- Hardware knobs (pin, count, brightness, baud, color) live in
  [`include/config.h`](include/config.h).
- Domain language: [`CONTEXT.md`](CONTEXT.md). Decisions: [`docs/adr/`](docs/adr).
- Agent / Linear / triage setup: [`CLAUDE.md`](CLAUDE.md) and `docs/agents/`.

## iPhone remote

`app/` is the iPhone app that controls the boots over Bluetooth, and its
[README](app/README.md) covers running, testing, and installing it. It works with no network.
