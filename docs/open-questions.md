# Open questions

Unresolved hardware facts. Recorded here, not hidden in code comments, so they get
decided deliberately. Once one is resolved, move the decision into `wiring.md`,
`power-budget.md`, `CONTEXT.md`, or an ADR as appropriate.

## Strip layout on a mounted shoe

- Where exactly does the strip get cut? A boot measures about **69 cm, which is about 110
  pixels** at 160 per meter, but the cut point isn't settled. Once it is, set each boot's
  count, toe, and heel from the iPhone remote's Calibrate sheet, then update the figures in
  `power-budget.md`. The soft cap of 96 assumes no boot strip is longer than 107 pixels
  (3EB5's count), so lower `FIREWALKER_LED_BRIGHTNESS_SOFT_CAP` for a longer one. Until then a
  boot starts from the uncut bench strip in `include/config.h` (160 pixels, toe 52, heel 132),
  which the `cli` tool also reads.
- Do the animation speeds still look right? `FLOW_TRAIL_SPEED_PXPS`, `FLOW_TRAIL_LEN`,
  `FIRE_TRAIL_SPEED_PXPS`, and `FIRE_TRAIL_LEN` count in pixels and were tuned on a far less
  dense strip, so the same values now cover a much shorter physical distance.

## Mount and motion calibration

Both shoes mount the controller in the same orientation and share one axis map in
`include/firewalker_mg24_mount.h`. That map has only been confirmed on the bench mount,
so check each mounted shoe:

- **Axes and signs:** does the fused angle follow the foot, both on a slow static tilt and a
  quick movement? Check with `./cli flow --motion --log-motion`. Captured heel and toe poses
  correct a reversed direction, but they can't repair a wrong axis or gyro sign.
- **Stomp thresholds:** what does a real stomp and an ordinary step produce on a mounted
  shoe? Tune `IMU_STOMP_ACCEL_THRESHOLD`, `IMU_RELEASE_ACCEL_THRESHOLD`,
  `IMU_REFRACTORY_MS`, and `IMU_STOMP_FORCE_FULL`.
- **Fire-trail origin:** do real stomps start from the part of the boot that's down? Each
  stomp logs its angle and origin over USB, so tune `FIRE_TRAIL_FLAT_DEG` if a flat stomp reads
  as toe or heel, or a heel strike reads as flat.
- **Worn pose captures:** does `CALIBRATION_MAX_SPREAD_DEG` in `include/config.h` let you
  capture neutral, heel, and toe while wearing the boot, and still reject a foot rocking back
  and forth?
- **Filter feel:** do `IMU_FILTER_ALPHA` and `IMU_TILT_FULL_DEG` still feel right?

## Power

- How is the strip powered in the final wearable? The battery and enclosure are outside
  the current firmware work, and the answer sets the real brightness ceiling.
- What are the strip's actual idle and peak currents? `power-budget.md` scales the
  manufacturer's rating to the measured 69 cm.
- Is the 5V pad really behind diode D1? Seeed's wiring sheet puts it there, but its block
  diagram and the wiki's pin map put the pad straight on VBUS. Meter the pad against the USB
  supply with the strip lit: a drop of a few tenths of a volt means D1 is in the path.

## Signal

- Does the mounted wiring run still read 3.3 V data reliably, or does the wearable need
  the level shifter from `wiring.md`?

## Wearable construction

- How does the strip attach to the shoe, and how is the controller enclosed and
  strain-relieved?
- How do the electronics come off for washing?

## Scope guardrails

In scope: one strip per shoe, the onboard sensor, native patterns and recipes, the iPhone
remote, the USB console, the designer, and the `cli` bench tool. Out of scope: the 2-D
"perimeter bubble" flow, multiple strips per shoe, synchronization between shoes,
Android, over-the-air firmware updates, and the final battery and enclosure.

## Conventions

- Hardware constants live in `include/config.h`, never hard-coded in the mode or core
  source files.
- Hardware uncertainty is documented in `docs/`, not buried in code comments.
- Durable decisions are recorded as ADRs under `docs/adr/`.
