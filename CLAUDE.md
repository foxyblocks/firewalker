# Firewalker

Wearable NeoPixel LED-shoe firmware. **PlatformIO + Arduino framework** (see
`docs/adr/0001-use-platformio-arduino-framework.md`). Current board: Adafruit
Feather RP2040.

**Current phase: IMU-driven, runtime light patterns.** Drive 39 pixels of one
WS2812B strip from a GY-521 / MPU-6050 IMU (I2C). The app (`final_app`) runs
runtime-switchable **patterns** — `flow` (magenta pooling gradient driven by
fused fore-aft tilt; a stomp doubles brightness then eases back) and `fire-trail`
(stomp-spawned fire bands). **D6 cycles patterns**; it boots into `flow`. A stomp
is an IMU acceleration spike. `imu_debug` logs accel/gyro + fused tilt and mirrors
tilt as strip brightness for bench calibration. The onboard NeoPixel lights solid
in every mode. The FSR is retired (see `docs/adr/0002`). Out of scope (still):
the 2-D "perimeter bubble" flow, multiple strips, wireless. Don't over-engineer
ahead of working hardware.

## Project map

- `include/config.h` — all hardware/behavior knobs (pin, count, brightness, IMU,
  flow, fusion axes). Never hard-code these in source files.
- `src/main.cpp` — tiny Arduino dispatcher into the selected mode.
- `src/modes/` — compile-time builds (`final_app`, `imu_debug`), chosen by
  `platformio.ini` build flags via `include/modes/mode_select.h`.
- `src/patterns/` — runtime visual behaviors (`flow`, `fire_trail`) behind the
  `Pattern` interface (`include/patterns/pattern.h`).
- `src/firewalker_imu.cpp` — shared IMU service: read, complementary-filter tilt,
  stomp detect. Used by the app and `imu_debug`.
- `src/firewalker_core.cpp` — shared strip, onboard pixel, D6 button, fire-trail
  engine, idle fill.
- `CONTEXT.md` — domain glossary; reuse these terms.
- `docs/wiring-mpu6050.html`, `docs/wiring.md`, `docs/wiring-extra-effort.html`,
  `docs/power-budget.md` — IMU wiring, legacy minimal wiring, protective
  reference wiring, current math.
- `docs/open-questions.md` — unresolved hardware facts + the bench-calibration
  checklist (axes/signs, toe-apex index, thresholds).
- `docs/adr/` — durable decisions.

## Build / upload / monitor

```bash
pio run                              # build default final_app mode
pio run -e final_app -t upload       # flash the app (flow + fire-trail patterns)
pio run -e imu_debug -t upload       # flash the IMU bench/calibration build
pio device monitor -e imu_debug      # watch debug logs at 115200 baud
```

## Working conventions

- Small, verifiable steps; build after meaningful changes.
- Hardware smoke tests are verified via serial / eyeball, not unit tests. Use
  TDD (`/tdd`) for pure logic (e.g. future animation math), not bring-up.
- Use `/diagnose` for build / upload / serial / LED-behavior failures.

## Agent skills

### Issue tracker

Issues & PRDs live in Linear — workspace `foxyblocks`, team `FOX`, project *Firewalker shoes*; driven via the `linear-cli` skill (always pass `--workspace foxyblocks`). See `docs/agents/issue-tracker.md`.

### Triage labels

The five triage roles map to Linear: `Triage` state, `Needs input` label, `ready-for-agent`/`ready-for-human` labels, `Canceled` state. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root (created lazily). See `docs/agents/domain.md`.
