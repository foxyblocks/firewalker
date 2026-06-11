# Wiring — MPU-6050 (GY-521) IMU build

Wiring for the accelerometer/gyroscope variant: an **HiLetgo GY-521 (MPU-6050,
6-DOF)** read over I2C, the candidate replacement for the FSR stomp sensor. Only
the `imu_debug` firmware mode uses it today (`pio run -e imu_debug -t upload`).

This is **additive** to the existing Feather RP2040 rig — the NeoPixel strip,
the D6 debug button, and power wiring are unchanged (see [`wiring.md`](wiring.md)).
The IMU just adds four I2C wires. In `imu_debug` the FSR/A0 path is left unused;
the IMU is the stomp trigger.

See the rendered diagram in [`wiring-mpu6050.html`](wiring-mpu6050.html).

## MPU-6050 (GY-521) ↔ Feather RP2040

| GY-521 pin | Feather RP2040 | Notes |
|---|---|---|
| **VCC** | **3V3** | The GY-521 has an onboard regulator and I2C pull-ups. Powering it from **3V3** (not USB/5V) keeps the SDA/SCL pull-ups at 3.3 V, matching the Feather's logic — so no level shifter is needed on the I2C lines (unlike the 5 V NeoPixel data line). |
| **GND** | **GND** | Common ground with the Feather (and the strip's 5 V supply). |
| **SDA** | **SDA** | I2C data. On the Feather RP2040 the SDA header pin is **GPIO 2** (I2C1), shared with the STEMMA QT connector. |
| **SCL** | **SCL** | I2C clock. The SCL header pin is **GPIO 3** (I2C1). |
| **AD0** | **GND** | I2C address select. Low/GND → **0x68** (the default, `IMU_I2C_ADDR`); tie high to 3V3 for 0x69. Many GY-521 boards already pull AD0 low, so 0x68 is typical even floating — wiring it to GND makes it deterministic. |
| **INT** | — | Motion-interrupt output. The firmware polls at `IMU_SAMPLE_MS`, so leave it disconnected. |
| **XDA / XCL** | — | Auxiliary I2C master (for an external magnetometer). Unused — leave disconnected. |

If you have a STEMMA QT / Qwiic cable and a Qwiic-compatible breakout, the same
four lines (VCC/GND/SDA/SCL) can go through the Feather's STEMMA QT port instead
of the header pins — it's the same I2C1 bus. The bare GY-521 has 0.1" headers,
so the header-pin wiring above is the usual path.

## How the firmware uses it

The Adafruit MPU6050 driver reports acceleration in **m/s²**, *including*
gravity, so at rest the total magnitude `|a|` sits near **9.81**. A stomp/step is
a spike in `|a|`:

- Fires a trail once `|a|` rises above `IMU_STOMP_ACCEL_THRESHOLD` (default
  18 m/s² ≈ 1.8 g) and the `IMU_REFRACTORY_MS` window has elapsed, then re-arms
  only after `|a|` falls back below `IMU_RELEASE_ACCEL_THRESHOLD` — the same
  arm/release hysteresis the FSR uses, so one stomp = one trail.
- When idle, movement intensity (`|a| − 9.81`) maps to the idle yellow
  brightness, so shaking the board lights the strip — a quick "is it alive"
  check while watching the serial monitor.

All thresholds live in [`include/config.h`](../include/config.h) under the IMU
section and are **starting points** — expect to tune them once the sensor is
mounted on a real foot (tracked in [`open-questions.md`](open-questions.md)).

## Verifying

```bash
pio run -e imu_debug -t upload
pio device monitor -e imu_debug      # 115200 baud
```

Expected serial output:

```
[firewalker] mode=imu_debug
[firewalker] pixels=40 led pin=7 button pin=8 foot=right
[firewalker] mpu6050 ready @0x68
[firewalker] imu stomp |a|>=18.00 release<=12.00 refractory=250ms
[firewalker] imu a=(0.12,-0.34,9.79) |a|=9.80 g=(0.01,0.00,-0.02) armed=true
[firewalker] imu stomp @24.13
[firewalker] stomp -> trail (1 active)
```

`mpu6050 NOT found` means the I2C scan failed — recheck SDA/SCL aren't swapped,
that VCC is on 3V3 and GND is common, and that AD0 matches `IMU_I2C_ADDR`. The
D6 debug button still spawns trails even if the IMU is missing, so the strip
animation can be tested independently.

## Key rules

- **Power the GY-521 from 3V3, not 5 V.** That keeps the I2C pull-ups at the
  Feather's logic level — no level shifter on SDA/SCL.
- **Common ground everywhere** — Feather, IMU, and the strip's 5 V supply.
- **The strip is still 5 V** and its data line still wants the level-shifter
  treatment for a robust build (see
  [`wiring-extra-effort.html`](wiring-extra-effort.html)); the IMU changes
  nothing about strip power.
