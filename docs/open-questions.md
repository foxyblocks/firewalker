# Open questions — hardware unknowns

Unresolved hardware facts. Recorded here (not hidden in code comments) so they
get decided deliberately. Resolve → move the decision into `wiring.md`,
`power-budget.md`, `CONTEXT.md`, or an ADR as appropriate.

## Power delivery (highest priority)

- How is the strip powered in the **final wearable**? Single-cell LiPo + 5V
  boost? 2×AA? USB power bank? This sets the real current ceiling and the safe
  brightness/animation envelope.
- What is the **total** physical strip length vs. the 39 pixels currently
  driven? Worst-case current scales with the number actually lit.
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
with `imu_debug`:

- **Stomp thresholds**: what `|a|` does a real foot stomp/step produce when
  shoe-mounted? Tune `IMU_STOMP_ACCEL_THRESHOLD` / `IMU_RELEASE_ACCEL_THRESHOLD`
  / `IMU_REFRACTORY_MS`. Is bare magnitude enough, or is a smarter step-detect
  needed to reject ordinary walking?
- **Flow tilt axis + sign**: which accel axis runs heel↔toe (drives pooling),
  which gyro axis is the pitch rate for the complementary filter, and the signs.
  Confirm/flip from a resting `imu_debug` capture.
- **Toe-apex pixel index**: the strip loops heel→toe→heel, so the toe is mid-strip.
  Count the exact apex index (and whether the two sides have equal pixel counts)
  for the fore-aft position map.
- **Complementary-filter constant** and **max-tilt angle** that saturates the
  flow gradient — feel-tuned on the bench.

## Power / behavior

- The **flow** pattern is magenta (2 channels). At `LED_BRIGHTNESS = 100` every
  stomp flashes the whole strip to full magenta (~612 mA, ~1.2 s fade), over the
  USB budget — accepted risk for the bench demo; revisit (brightness cap or
  external 5 V) if it browns out. See `power-budget.md`.
- Desired animations and their power profile once the wearable power plan is set.
