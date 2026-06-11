# Firewalker

Wearable NeoPixel LED-shoe firmware. **PlatformIO + Arduino framework** (see
`docs/adr/0001-use-platformio-arduino-framework.md`). Current board: Adafruit
Feather RP2040.

**Current phase: IMU-driven, runtime light patterns.** Drive a 40-pixel
WS2812B strip from a GY-521 / MPU-6050 IMU (I2C). The strip is a closed ring
around the foot: pixel 0 at the inner ankle under the controller, toe at 13,
heel at 33. The app (`final_app`) runs runtime-switchable **patterns** — `flow`
(a slowly spectrum-cycling hue pooled toward the down-end by fused fore-aft
tilt; a stomp launches 4 diverging trail fronts from the down-point) and
`fire-trail` (stomp-spawned fire bands). **D6 cycles patterns**; it boots into
`flow`. A stomp is an IMU acceleration spike. Both shoes are identical hardware
builds; left vs right is a compile-time **foot side** flag (`final_app_left` /
`final_app_right` envs) that flips the chirality-sensitive IMU signs.
`imu_debug` logs accel/gyro + fused tilt and mirrors tilt as strip brightness
for bench calibration. The onboard NeoPixel lights solid in every mode. The FSR
is retired (see `docs/adr/0002`). Out of scope (still): the 2-D "perimeter
bubble" flow, multiple strips, wireless. Don't over-engineer ahead of working
hardware.

## Project map

- `include/config.h` — all hardware/behavior knobs, named by owning module
  (`IMU_*` incl. the `IMU_MOUNT_*` axis map, `FLOW_*`, `FIRE_TRAIL_*`). Never
  hard-code these in source files.
- `src/main.cpp` — tiny Arduino dispatcher into the selected mode.
- `src/modes/` — compile-time builds (`final_app`, `imu_debug`), chosen by
  `platformio.ini` build flags via `include/modes/mode_select.h`.
- `src/patterns/` — runtime visual behaviors (`flow`, `fire_trail`) behind the
  `Pattern` interface (`include/patterns/pattern.h`). Each pattern owns its own
  animation state and engine.
- `src/firewalker_imu.cpp` — shared IMU service: read, complementary-filter tilt,
  stomp detect. Used by the app and `imu_debug`.
- `include/firewalker_fusion.h` — the pure orientation/stomp math (filter step,
  hysteresis), Arduino-free; the IMU service adapts it, `test/` exercises it.
- `include/firewalker_strip_map.h` — the pure strip ring geometry (pixel →
  fore-aft position, toe/heel arc helpers), Arduino-free; `flow` uses it,
  `test/` exercises it.
- `src/firewalker_core.cpp` — shared hardware services: strip, onboard pixel,
  D6 button, idle fill.
- `test/` — host-native Unity tests for the pure math (`pio test -e native`).
- `CONTEXT.md` — domain glossary; reuse these terms.
- `docs/wiring-mpu6050.html`, `docs/wiring.md`, `docs/wiring-protoboard.md`,
  `docs/wiring-extra-effort.html`, `docs/power-budget.md` — IMU wiring, legacy
  minimal wiring, FeatherWing Proto carrier layout (FOX-183), protective
  reference wiring, current math.
- `docs/open-questions.md` — unresolved hardware facts + the bench-calibration
  checklist (axes/signs, toe-apex index, thresholds).
- `docs/adr/` — durable decisions.

## Build / upload / monitor

```bash
pio run                              # build default final_app mode
pio run -e final_app_left -t upload  # flash the app onto the LEFT shoe
pio run -e final_app_right -t upload # flash the app onto the RIGHT shoe
pio run -e final_app -t upload       # bench default (= right foot)
pio run -e imu_debug -t upload       # flash the IMU bench/calibration build
pio device monitor -e imu_debug      # watch debug logs at 115200 baud
pio test -e native                   # host-native tests of the pure IMU math
```

## Working conventions

- Small, verifiable steps; build after meaningful changes.
- Hardware smoke tests are verified via serial / eyeball, not unit tests. Use
  TDD (`/tdd`) for pure logic (the `pio test -e native` env exists for this —
  see `test/test_fusion/`), not bring-up.
- Use `/diagnose` for build / upload / serial / LED-behavior failures.

## Agent skills

### Issue tracker

Issues & PRDs live in Linear — workspace `foxyblocks`, team `FOX`, project *Firewalker shoes*; driven via the `linear-cli` skill (always pass `--workspace foxyblocks`). See `docs/agents/issue-tracker.md`.

### Triage labels

The five triage roles map to Linear: `Triage` state, `Needs input` label, `ready-for-agent`/`ready-for-human` labels, `Canceled` state. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root (created lazily). See `docs/agents/domain.md`.
