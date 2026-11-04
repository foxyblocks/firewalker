# Firewalker

Wearable LED-shoe firmware. **PlatformIO + Arduino framework** (see
`docs/adr/0001-use-platformio-arduino-framework.md`). Current board: Seeed Studio XIAO
MG24 Sense (see `docs/adr/0004-mg24-sense-and-ble-remote.md`).

**Current phase: the MG24 migration (FOX-271, `specs/mg24-migration-spec.md`).** Drive
one BTF FCOB strip (WS2812B-compatible, 160 pixels per meter) on D10 from the board's
onboard motion sensor. The strip is a closed ring around the foot, about 69 cm or 110
pixels. The firmware assumes the uncut 160 pixels until it's cut to length. The app (`final_app`) runs
runtime-switchable **patterns**: `flow` (a slowly spectrum-cycling hue pooled toward the
down-end by fused fore-aft tilt, where a stomp launches diverging trail fronts) and
`fire-trail` (stomp-spawned fire bands). A stomp is an IMU acceleration spike. Both
shoes run one identical firmware binary. Each controller saves its own pattern,
brightness, and calibrated poses (neutral, heel, toe) in flash. A **remote** controls running firmware
over BLE or the USB console with one line protocol. Out of scope: the 2-D "perimeter
bubble" flow, multiple strips per shoe, synchronization between shoes, and the final
battery and enclosure. Don't over-engineer ahead of working hardware.

## Project map

- `include/config.h` — all hardware/behavior knobs, named by owning module (`IMU_*`,
  `CALIBRATION_*`, `TILT_LIMITS`, `SETTINGS_*`, `REMOTE_*`, `FLOW_*`, `FIRE_TRAIL_*`). Never hard-code
  these in source files.
- `src/main.cpp` — tiny Arduino dispatcher into the selected mode.
- `src/modes/` — compile-time builds (`final_app`, `imu_debug`, `bench`), chosen by
  `platformio.ini` build flags via `include/modes/mode_select.h`.
- `src/patterns/` — runtime visual behaviors (`flow`, `fire_trail`) behind the
  `Pattern` interface (`include/patterns/pattern.h`). Each pattern owns its own
  animation state and engine.
- `src/firewalker_strip.cpp` — the strip driver behind `LedStrip`: hardware-timed, SPI + DMA on D10.
- `src/firewalker_imu.cpp` — shared IMU service: read, complementary-filter tilt, calibrated
  poses, stomp detect.
- `src/firewalker_remote.cpp` — the USB console and BLE service behind one line-based
  interface. The commands and replies are in `docs/remote-protocol.md`.
- `src/firewalker_settings_store.cpp` — saves settings to flash (NVM3).
- `src/firewalker_core.cpp` — shared hardware services: strip, status light, idle fill.
- `include/firewalker_fusion.h`, `firewalker_mg24_mount.h`, `firewalker_strip_map.h`,
  `firewalker_calibration.h`, `firewalker_settings.h`, `firewalker_remote_protocol.h` — pure,
  Arduino-free logic that `test/` exercises off-hardware.
- `tools/pio/mg24_stack.py` — PlatformIO build step: picks the core's radio stack, pins
  Arm's compiler, and makes uploads target exactly one board.
- `tools/cli/` and `./cli` — the bench CLI: flag-configured strip tests.
- `test/` — host-native Unity tests for the pure logic (`pio test -e native`).
- `CONTEXT.md` — domain glossary; reuse these terms.
- `docs/wiring.md`, `docs/power-budget.md` — wiring and current math.
- `docs/remote-protocol.md` — what the iPhone app and USB console speak.
- `docs/open-questions.md` — unresolved hardware facts + the mounted-shoe checklist.
- `docs/adr/` — durable decisions.

## Build / upload / monitor

```bash
pio run                                # build the default app
pio run -e final_app -t upload         # flash the app (the same on both shoes)
pio run -e imu_debug -t upload         # flash the motion calibration build
pio run -e strip_test -t upload        # cycle colors on every pixel
pio run -e strip_off -t upload         # blank every pixel
pio device monitor                     # USB console + logs at 115200 baud
pio test -e native                     # host-native tests of the pure logic
(cd tools/cli && go test ./...)       # tests for the bench CLI

./cli flow --motion --log-motion      # one-off strip test, see README.md
```

With two boards connected, uploads refuse to guess. Add `--upload-port <usb serial>`;
`pio device list` shows each board's serial.

The USB port carries the sketch's `Serial` both ways, so logs and commands need no UART
adapter. Over SWD, `pio run -t upload` also recovers a board whatever it's running.

## Working conventions

- Small, verifiable steps; build after meaningful changes.
- Hardware smoke tests are verified via serial / eyeball, not unit tests. A successful
  upload doesn't verify the LED signal, so check changes to the strip driver on the real
  strip. Use TDD (`/tdd`) for pure logic (the `pio test -e native` env exists for this —
  see `test/test_fusion/`), not bring-up.
- Use `/diagnose` for build / upload / serial / LED-behavior failures.

## Agent skills

### Issue tracker

Issues & PRDs live in Linear — workspace `foxyblocks`, team `FOX`, project *Firewalker shoes*; driven via the `linear-cli` skill (always pass `--workspace foxyblocks`). See `docs/agents/issue-tracker.md`.

### Triage labels

The five triage roles map to Linear: `Triage` state, `Needs input` label, `ready-for-agent`/`ready-for-human` labels, `Canceled` state. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root (created lazily). See `docs/agents/domain.md`.
