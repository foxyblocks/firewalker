# Open questions

Unresolved hardware facts. Recorded here, not hidden in code comments, so they get
decided deliberately. Once one is resolved, move the decision into `wiring.md`,
`power-budget.md`, `CONTEXT.md`, or an ADR as appropriate.

## Strip layout on a mounted shoe

- What's the real pixel count and ring layout per shoe? The firmware uses the bench
  layout (160 pixels, toe 52, heel 132), which scales the old 40-pixel ring by four. It
  isn't a measurement. Set `FIREWALKER_LED_COUNT`, `FIREWALKER_STRIP_TOE_INDEX`, and
  `FIREWALKER_STRIP_HEEL_INDEX` in `include/config.h` once a shoe is assembled.
- Do the animation speeds still look right? `FLOW_TRAIL_SPEED_PXPS`, `FLOW_TRAIL_LEN`,
  `FIRE_TRAIL_STEP_MS`, and `FIRE_TRAIL_LEN` count in pixels and were tuned on a far less
  dense strip, so the same values now cover a much shorter physical distance.

## Mount and motion calibration

Both shoes mount the controller in the same orientation and share one axis map in
`include/firewalker_mg24_mount.h`. That map has only been confirmed on the bench mount,
so check each mounted shoe:

- **Axes and signs:** does toe-down read as positive tilt? Check both a slow static tilt
  and a quick movement with `./cli flow --motion --log-motion`. Neutral calibration
  can't repair a wrong axis or gyro sign.
- **Stomp thresholds:** what does a real stomp and an ordinary step produce on a mounted
  shoe? Tune `IMU_STOMP_ACCEL_THRESHOLD`, `IMU_RELEASE_ACCEL_THRESHOLD`,
  `IMU_REFRACTORY_MS`, and `IMU_STOMP_FORCE_FULL`.
- **Neutral capture bounds:** the `NEUTRAL_*` values in `include/config.h` pass on a
  still bench. Do they also pass for a boot held still by hand, and reject a boot that's
  really moving?
- **Filter feel:** does `IMU_FILTER_ALPHA` and `IMU_TILT_FULL_DEG` still feel right?

## Power

- How is the strip powered in the final wearable? The battery and enclosure are outside
  the current firmware work, and the answer sets the real brightness ceiling.
- What are the strip's actual idle and peak currents? `power-budget.md` uses the
  manufacturer's rating.

## Signal

- Does the mounted wiring run still read 3.3 V data reliably, or does the wearable need
  the level shifter from `wiring.md`?

## Wearable construction

- How does the strip attach to the shoe, and how is the controller enclosed and
  strain-relieved?
- How do the electronics come off for washing?

## Scope guardrails

In scope: one strip per shoe, the onboard sensor, the flow and fire-trail patterns, the
iPhone remote, the USB console, and the `cli` bench tool. Out of scope: the 2-D
"perimeter bubble" flow, multiple strips per shoe, synchronization between shoes,
Android, over-the-air firmware updates, and the final battery and enclosure.

## Conventions

- Hardware constants live in `include/config.h`, never hard-coded in the mode or core
  source files.
- Hardware uncertainty is documented in `docs/`, not buried in code comments.
- Durable decisions are recorded as ADRs under `docs/adr/`.
