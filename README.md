# Firewalker Shoes

Wearable LED-shoe firmware, inspired by Adafruit's Gemma LED Sneakers /
Firewalker guide. Built with **PlatformIO + Arduino framework** in VS Code (not
the Arduino IDE).

> **Status:** FSR-triggered animation on the Feather RP2040 rig. The firmware drives
> **39 pixels** of one WS2812B strip: each pressure stomp launches a **fire
> trail** — a band that travels bottom→top with a hot head cooling through
> orange to a deep-red tail, wiping in at the bottom and out at the top.
> Presses stack into several trails at once. The FSR is the current stomp sensor,
> with a D6 debug button kept for bench testing; an `imu_debug` mode evaluates a
> GY-521 / MPU-6050 accelerometer+gyro over I2C as a candidate replacement. No
> wireless yet. The onboard NeoPixel lights solid in every mode as a power indicator.

## Hardware

| | |
|---|---|
| Board | Adafruit Feather RP2040 |
| LED strip | WS2812B, `NEO_GRB` + 800 KHz |
| Data pin | Feather **D5** → strip DIN (direct, no level shifter on current rig) |
| Pixels driven | 39 (current strip length) |
| Stomp sensor | FSR voltage divider on Feather **A0** |
| IMU (optional) | GY-521 / MPU-6050 over I2C (**SDA**/**SCL**, 3V3) — used by `imu_debug` |
| Debug trigger | Momentary button from Feather **D6** → GND (`INPUT_PULLUP`) |
| Status light | Onboard **NeoPixel** (GP16), lit solid in every mode |
| Power | Feather **USB/VBUS** → strip 5V, common ground — current scales with brightness × pixels lit (see [`docs/power-budget.md`](docs/power-budget.md)) |

See [`docs/wiring.md`](docs/wiring.md) for the current minimal (FSR) wiring,
[`docs/wiring-mpu6050.html`](docs/wiring-mpu6050.html) for the MPU-6050 IMU
wiring, [`docs/wiring-extra-effort.html`](docs/wiring-extra-effort.html) for the
level-shifter/resistor reference, and
[`docs/open-questions.md`](docs/open-questions.md) for unresolved hardware
decisions.

## Quick start

```bash
# Build the default final app mode
pio run

# Upload the final app mode to a connected Feather RP2040
pio run -e final_app -t upload

# Upload the FSR sensor debug mode
pio run -e fsr_debug -t upload

# Upload the MPU-6050 IMU debug mode
pio run -e imu_debug -t upload

# Watch serial output for the active mode (115200 baud)
pio device monitor -e fsr_debug
```

Expected final app serial output:

```
[firewalker] mode=final_app
[firewalker] pixels=39 led pin=7 fsr pin=26 stomp threshold=700 release threshold=400 debug button=8
[firewalker] fsr stomp @728
[firewalker] stomp -> trail (1 active)
...
```

Expected FSR debug serial output:

```
[firewalker] mode=fsr_debug
[firewalker] pixels=39 led pin=7 fsr pin=26 stomp threshold=700 release threshold=400 debug button=8
[firewalker] fsr raw=728 force=628 brightness=72 armed=true
[firewalker] stomp -> trail (1 active)
...
```

In `final_app`, the strip is dark except for the green boot pixel until the FSR
or D6 debug button launches a fire trail.

In `fsr_debug`, the FSR only controls the idle yellow brightness. The D6 debug
button still launches fire trails for animation testing.

When no trails are active, the whole strip lights yellow with brightness mapped
from the current FSR reading. Baseline is roughly 100-300; hard pressure trends
toward 700-1000, so a hard squeeze trends brighter. This makes FSR pressure
visible while watching the serial monitor.

In `imu_debug`, a GY-521 / MPU-6050 is read over I2C (see
[`docs/wiring-mpu6050.html`](docs/wiring-mpu6050.html)). It logs raw accel/gyro,
fires a fire trail when total acceleration spikes past the stomp threshold
(re-arming with hysteresis), and otherwise maps movement intensity to idle
brightness — so shaking the board lights the strip. The D6 button still spawns
trails, so the animation works even if the IMU is absent.

```
[firewalker] mode=imu_debug
[firewalker] pixels=39 led pin=7 debug button=8
[firewalker] mpu6050 ready @0x68
[firewalker] imu a=(0.12,-0.34,9.79) |a|=9.80 g=(0.01,0.00,-0.02) armed=true
[firewalker] imu stomp @24.13
[firewalker] stomp -> trail (1 active)
...
```

## ⚠️ Power safety

Current scales with **brightness × pixels lit**, and trails stack — so the
worst case is the whole strip lit by overlapping trails. Before running
brighter, longer, or with more pixels, read
[`docs/power-budget.md`](docs/power-budget.md) and use a dedicated 5V strip
supply with grounds tied together.

## Project conventions

- Hardware knobs (pin, count, brightness, baud, color) live in
  [`include/config.h`](include/config.h).
- Domain language: [`CONTEXT.md`](CONTEXT.md). Decisions: [`docs/adr/`](docs/adr).
- Agent / Linear / triage setup: [`CLAUDE.md`](CLAUDE.md) and `docs/agents/`.
