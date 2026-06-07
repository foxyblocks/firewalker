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
- FSR placement: heel, ball of foot, or another pressure point? This changes the
  real rest/stomp readings and thresholds.
- Connector strategy for removing electronics before washing?

## Behavior (later — out of current scope)

- FSR calibration: what are the actual rest, walking, and stomp readings once
  the sensor is mounted in the shoe?
- FSR vs IMU: does the GY-521 / MPU-6050 (`imu_debug`) detect stomps more
  reliably than the FSR? If so, wire it into `final_app` and retire the FSR path.
- IMU calibration: what acceleration magnitude does a real foot stomp/step
  produce when the board is shoe-mounted? Tune `IMU_STOMP_ACCEL_THRESHOLD` /
  `IMU_RELEASE_ACCEL_THRESHOLD` / `IMU_REFRACTORY_MS` from that. Is bare
  magnitude enough, or is gyro / a smarter step-detect needed to reject walking?
- IMU mount orientation on the shoe (which axis sees the impact)?
- Desired animations and their power profile once the above is settled?
