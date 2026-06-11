# Open questions — hardware unknowns

Unresolved hardware facts. Recorded here (not hidden in code comments) so they
get decided deliberately. Resolve → move the decision into `wiring.md`,
`power-budget.md`, `CONTEXT.md`, or an ADR as appropriate.

## Power delivery (highest priority)

- How is the strip powered in the **final wearable**? Single-cell LiPo + 5V
  boost? 2×AA? USB power bank? This sets the real current ceiling and the safe
  brightness/animation envelope. (The strip itself is settled: exactly 40
  pixels, all driven — see CONTEXT.md "Strip".)
- Current bench rig intentionally omits the data-line resistor, bulk capacitor,
  and level shifter. At what brightness/length/use case do we upgrade to the
  extra-effort wiring?

## Controller / logic level

- Current controller is the Adafruit Feather RP2040, with direct 3.3V data into
  the strip. Does the final wearable need a 5V level shifter for reliability?

## Wearable constraints

- Mounting: how/where does the strip attach to the shoe, and how is the
  controller + battery enclosed and strain-relieved?
- Connector strategy for removing electronics before washing?

## IMU calibration (bench — Feather is connected)

The IMU is the stomp sensor (the FSR is retired). These constants are baked in
`config.h` from a known mount (Feather on its side on the outer ankle, USB toward
the heel; GY-521 co-mounted), but the exact axis/sign/values need a bench pass
with `imu_debug`.

**The protoboard carrier (FOX-183, `wiring-protoboard.md`) mounts on the inner
ankle of both shoes** — identical hardware, USB up the leg, exposed face
outward. The axis *assignments* (X fore-aft, Y vertical, Z pitch) match the
already-bench-confirmed USB-up orientation, but the chirality-sensitive signs
now depend on the foot: `IMU_MOUNT_FOOT_SIGN` flips fore-aft and pitch-gyro
between left and right, and which physical foot gets which sign is a
geometry-derived hypothesis (left = current bench signs). Confirm with
`imu_debug` on each shoe after assembly:

- **Stomp thresholds**: what `|a|` does a real foot stomp/step produce when
  shoe-mounted? Tune `IMU_STOMP_ACCEL_THRESHOLD` / `IMU_RELEASE_ACCEL_THRESHOLD`
  / `IMU_REFRACTORY_MS`. Is bare magnitude enough, or is a smarter step-detect
  needed to reject ordinary walking?
- **Flow tilt axis + sign**: which accel axis runs heel↔toe (drives pooling),
  which gyro axis is the pitch rate for the complementary filter, and the signs.
  Confirm/flip from a resting `imu_debug` capture.
- **Complementary-filter constant** and **max-tilt angle** that saturates the
  flow gradient — feel-tuned on the bench.

## Power / behavior

- The **flow** pattern's spectrum-cycling hue passes through 2-channel colors
  (yellow / cyan / magenta): a full strip at `LED_BRIGHTNESS = 100` is ~630 mA,
  over the USB budget, and pooling + stacked trails can approach it — accepted
  risk for the bench demo; revisit (brightness cap or external 5 V) if it
  browns out. See `power-budget.md`.
- Desired animations and their power profile once the wearable power plan is set.
