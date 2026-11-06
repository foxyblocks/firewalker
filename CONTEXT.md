# Context — Firewalker Shoes

Domain language for this project. Keep terms here precise and reuse them in
code, issues, and docs rather than drifting to synonyms.

## Glossary

- **Firewalker** — the overall wearable: an LED-lit shoe driven by a small
  microcontroller. Named after Adafruit's Firewalker LED-sneakers project.
- **Mode** — a *compile-time* build variant selected by `platformio.ini` build
  flags and dispatched in `include/modes/mode_select.h` (`final_app`,
  `imu_debug`, `bench`). Distinguishes which **build** is compiled — the app, the
  IMU sensor-debug build, or a one-off strip test. Do **not** use "mode" for a
  visual behavior — that's a **Pattern**.
- **Pattern** — a *runtime-selectable* visual behavior of the strip (**flow**,
  **fire-trail**). One firmware holds the active pattern, and the **remote**
  switches between them live or turns the strip off. _Avoid_: "light mode",
  "animation mode".
- **Fire-trail** — the Pattern where each **stomp** spawns a **trail** from whichever
  part of the boot is down, running along both sides of the foot to the opposite part;
  several stack at once.
- **Flow** — the Pattern where the strip shares one hue that slowly rotates
  through the spectrum and "pools": at level it glows a flat dim baseline, and
  as the foot tilts brightness drains from the up-end and concentrates into a
  tight pool at whichever end tilts down, tracking the shoe's **orientation**.
  A **stomp** launches **trail**
  fronts from the tilt-derived "down" point — up to 4 bands (2 per arc of the
  strip ring) diverging to the heel and toe, each a white head → current hue →
  previous hue.
- **Strip** — one addressable RGB LED strip on one data pin: a BTF FCOB strip with
  an XGB1338 controller, which is WS2812B-compatible. Routed as a closed **ring**
  around the foot perimeter: pixel 0 starts directly under the controller, runs
  forward along one side to the **toe apex**, back along the other side to the
  **heel**, and returns to the start. Index order is *not* the heel→toe axis; the
  pure map in `include/firewalker_strip_map.h` gives each pixel its fore-aft foot
  position.
- **Strip layout** — the pixel count of a ring, and which pixels sit at the toe and
  heel. Each controller saves its own, set from a remote. The ring can run either way,
  so toe and heel fall in either order.
- **Strip preview** — what the strip shows in place of its pattern while the layout is
  being set: the ring in blue, with one yellow pixel at the toe and one purple at the heel.
- **Pixel** — one addressable RGB LED on the strip. Costs 3 bytes of controller
  SRAM, and draws about 10 mA at full white by the strip's rating.
- **DIN** — the strip's data input line, driven from the controller's D10 pad. The
  bench rig uses direct data wiring; `docs/wiring.md` lists what to add if the signal
  gets unreliable.
- **Bring-up** — the initial phase (now complete): prove build → upload → data
  line → lit pixels → serial status. "Boring and verifiable."
- **Brightness** — the global 0–255 scale applied to every channel when a frame is
  sent. Each controller saves its own, up to its soft cap while that's on, or 255 with it
  off. Trades visibility against current draw, and isn't a current limit; see the power budget.
- **Soft cap** — the brightness each boot holds to unless a remote turns it off,
  `LED_BRIGHTNESS_SOFT_CAP` (96), so a USB-fed strip stays inside what USB supplies. A new boot
  starts at it. Each boot saves whether its cap is on, and turning it back on brings brightness
  down to it. Off is for a dedicated 5 V supply.
- **Trail** — the bands of fire one stomp spawns, each `FIRE_TRAIL_LEN` pixels long.
  Toe down runs one band per side from the toe to the heel, heel down runs them from the
  heel to the toe, and flat runs four outward from the middle of each side. Bands **wipe
  in** at their origin and **out** at the far end (no hold). Several trails run at once
  (`FIRE_TRAIL_MAX`).
- **Fire gradient** — a trail's color ramp: a hot head cooling through the
  `FIRE[]` stops to a red tail, precomputed once per `FIRE_TRAIL_LEN`.
- **Stomp** — a trigger event: a foot impact. Detected from an **IMU**
  acceleration spike.
- **IMU** — the MG24 Sense's onboard LSM6DS3TR-C accelerometer + gyroscope, the
  shoe's motion sensor. A stomp is a spike in total acceleration magnitude `|a|`
  above the ~9.81 m/s² gravity baseline.
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
- **Pose** — a held position of the boot, captured per controller to calibrate **tilt**:
  **neutral** (at rest, tilt 0), **heel** (heel-down, tilt -1), and **toe** (toe-down,
  tilt +1). Each is an absolute fused angle in degrees, saved in that controller's flash.
  Heel and toe are optional, and a skipped side uses a default range. Poses set where tilt
  lands and which way it runs. They don't change the strip's toe and heel positions, which
  are pixel indices, or stomp thresholds.
- **Settings** — what each controller remembers across power cycles: its pattern,
  brightness, and poses. They live in the controller's own flash, never in the build,
  so both shoes run the same firmware binary.
- **Recipe** — a pattern described as data rather than code: a JSON file of **layers**
  (`docs/recipe-format.md`). The **designer** makes them, and `patterns/` keeps them. A boot
  runs the compiled form, which a recipe has to fit in 254 bytes to have (ADR-0005).
- **Native pattern** — a pattern written in C++: `flow` and `fire-trail`. A recipe can't take
  one of their names.
- **Kept recipe**, or **keeper** — any recipe in `patterns/`. It's in the repo, but it only
  reaches a boot by being built in or uploaded.
- **Built-in recipe** — a keeper listed in `patterns/built-ins.txt`, compiled into the firmware
  so every boot ships with it.
- **Uploaded recipe** — a recipe stored in one boot's flash, in one of its **slots**, sent over
  BLE or USB with no firmware build. One can hide a built-in of the same name on that boot.
- **Layer** — one part of a recipe that paints the strip (fill, pool, trail, flash,
  sparkle, chase), combined with the layers below it by its blend.
- **Knob** — a recipe number that is either fixed or a **binding**: it follows tilt, tilt
  amount, stomp strength, a fading stomp, or a wave, between a min and a max.
- **Designer** — the web app in `designer/` that edits recipes and simulates them on a
  drawn boot with a tilt slider and a stomp button. Not the iPhone **remote**.
- **Remote** — anything controlling running firmware through the line protocol in
  `docs/remote-protocol.md`: the iPhone app over BLE, or a USB serial console. Distinct
  from the **`cli` bench tool**, which builds and flashes one-off test firmware.
- **Status light** — the board's onboard LED: solid when running, a slow blink if the
  IMU is missing, a fast blink during a neutral capture. It's independent of the strip
  and of any phone or serial monitor.
- **Power budget** — the current ceiling imposed by the power source (USB vs
  external 5V). Governs the brightness cap and which colors are safe.

## Scope guardrails (current phase)

In scope now: one strip per shoe; the **IMU** as the sole stomp sensor; runtime
**patterns** on the app, both native and **recipes**, built in or uploaded; the BLE and USB
**remote**; per-controller **settings**; the `imu_debug` build and the `cli` bench tool; and the
**designer**. Still
explicitly **out** of scope: the 2-D "perimeter bubble" flow (roll as well as pitch),
multiple strips per shoe, synchronization between shoes, battery management and the
wearable power plan, and premature performance work.

## Conventions

- Hardware constants live in `include/config.h`, never hard-coded in the mode or
  core source files.
- Hardware uncertainty is documented in `docs/`, not buried in code comments.
- Durable decisions are recorded as ADRs under `docs/adr/`.
