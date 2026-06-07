# Firewalker

Wearable NeoPixel LED-shoe firmware. **PlatformIO + Arduino framework** (see
`docs/adr/0001-use-platformio-arduino-framework.md`). Current board: Adafruit
Feather RP2040.

**Current phase: FSR-triggered animation, evaluating an IMU trigger.** Drive 39
pixels of one WS2812B strip; an FSR voltage divider on Feather A0 drives a
non-blocking, stacking fire-trail animation in `final_app`, with a D6 debug
button kept for bench testing. `fsr_debug` maps live FSR pressure to idle yellow
brightness and keeps the D6 button available for trail testing. `imu_debug`
exercises a GY-521 / MPU-6050 accelerometer+gyro over I2C as a candidate stomp
trigger to replace the FSR: it logs motion, fires trails from acceleration
spikes, and shows movement intensity as idle brightness. The onboard NeoPixel
lights solid in every mode as a power/running indicator. Out of scope (still): wiring
the IMU into `final_app`, multiple strips, wireless. Don't over-engineer ahead
of working hardware.

## Project map

- `include/config.h` — all hardware knobs (pin, count, brightness, baud, color).
  Never hard-code these in mode files.
- `src/main.cpp` — tiny Arduino dispatcher into the selected mode.
- `src/modes/` — runtime modes (`final_app`, `fsr_debug`, `imu_debug`). The
  MPU-6050 driver is only linked into `imu_debug`; its `.cpp` body is `#if`-gated
  on the mode so the other envs don't compile it.
- `src/firewalker_core.cpp` — shared strip, FSR, debug-button, onboard-LED, and
  trail logic (sensor-agnostic; the IMU code lives in the `imu_debug` mode).
- `CONTEXT.md` — domain glossary; reuse these terms.
- `docs/wiring.md`, `docs/wiring-mpu6050.html`, `docs/wiring-extra-effort.html`,
  `docs/power-budget.md` — current minimal (FSR) wiring, the MPU-6050 IMU wiring,
  protective reference wiring, and current math.
- `docs/open-questions.md` — unresolved hardware facts (don't bury uncertainty
  in code comments; record it here).
- `docs/adr/` — durable decisions.

## Build / upload / monitor

```bash
pio run                              # build default final_app mode
pio run -e final_app -t upload       # flash finalized behavior
pio run -e fsr_debug -t upload       # flash FSR sensor debug behavior
pio run -e imu_debug -t upload       # flash MPU-6050 IMU debug behavior
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
