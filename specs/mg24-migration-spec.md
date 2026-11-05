# MG24 Sense and BTF FCOB strip migration

Status: In progress. The Feather and prototype paths are removed, and the MG24 is the only
target. Mounted-shoe and external-5V checks are still open, and the BLE remote is a custom
Capacitor app (FOX-269). This spec describes the starting point as well as the goal, so its
references to `proto/` and the Feather are history.
Date: 2026-11-02

## Summary

Make the tested Seeed Studio XIAO MG24 + BTF-LIGHTING WS2812B-compatible FCOB
strip combination the project's supported hardware. Retire the Feather RP2040
and external MPU-6050 hardware path, and bring the chosen features into one
documented PlatformIO workflow.

Confirmed strip reference: [Amazon ASIN B0CNXKSWD7](https://www.amazon.com/dp/B0CNXKSWD7),
model **FCOB-5V-160L-W-IP30-SPI-5MM**. This is the approximately 1m / 3.2ft,
160-pixel, 5V RGB FCOB strip with a 5mm PCB and IP30 rating. The listed IC is
**XGB1338**, marketed as WS2812B-compatible. Target that protocol and the actual
strip's measured behavior; do not assume an original Worldsemi WS2812B package,
RGBW data, grouped pixels, or generic older-strip current figures.

Keep both existing patterns and motion behavior, replace button controls with a
BLE remote on iPhone, and use the same firmware on both identically
oriented shoe mounts. Completion requires both mounted shoes to work. Support
USB bench tests and external 5V; defer the final battery design.

The planned Firewalker remote provides pattern/off selection, brightness, live motion/status
debugging, and a **Calibrate neutral** action. Each controller remembers its own
selected pattern, brightness, and neutral calibration across power cycles.

The `cli` bench tool built for local debugging stays a supported interface
alongside the remote. It builds, flashes, and runs tests from a USB-connected
computer, so bench work doesn't depend on the phone.

The existing prototype targets the **MG24 Sense**, using its onboard motion
sensor. This draft assumes that is the selected board; the non-Sense board
does not satisfy that motion-sensor requirement without additional hardware.

## Problem Statement

The main firmware, configuration, and user documentation still describe the
Feather rig. The working MG24 code lives under `proto/xiao_mg24/`, with its own
driver, calibration, entry point, and build setup. PlatformIO builds the MG24
color/off diagnostics, while the motion-driven prototype uses Arduino CLI.
Several guides describe hardware and behavior that are no longer current.

## Goals

- Support the selected MG24 Sense + BTF FCOB strip as the sole hardware target.
- Preserve flow, fire-trail, tilt fusion, stomp detection, and stomp strength.
- Replace physical button controls with an iPhone BLE remote for debugging and
  pattern selection. Build and verify the remote in FOX-269.
- Support the `cli` bench tool alongside the remote for debugging and running
  patterns and diagnostics locally.
- Use the same firmware on both shoes mounted in the same controller orientation.
- Preserve color test, all-off, and motion-calibration diagnostics.
- Persist pattern, brightness, and neutral calibration independently on each
  controller, while keeping the firmware binary identical for both shoes.
- Build and upload every retained firmware mode from the root PlatformIO project.
- Put pins, strip configuration, brightness, and motion calibration in clear,
  shared configuration rather than separate prototype overrides.
- Remove retired code, dependencies, commands, and active wiring guides after
  validating the replacement on hardware.

## Non-Goals

- A second supported controller or external motion-sensor fallback.
- Restoring FSR support, which was already retired by ADR-0002.
- Left/right-specific firmware or flashing workflows.
- Physical pattern-cycle button support and the standalone DC probe sketch.
- New animations, synchronization between shoes, or 2D flow.
- Android support, or over-the-air firmware updates.
- Arbitrary live editing of pattern parameters, palettes, motion axes, or stomp
  thresholds from the phone; the initial tuning controls are brightness and
  neutral-position calibration.
- Designing the final battery or enclosure. Mounting/calibration checks on both
  shoes remain part of acceptance, using the proposed clipped controller mount.

## Users / Stakeholders

Christian builds, tunes, and flashes the prototype and wearable shoes. Another
agent or engineer should be able to use the current README and configuration
without reconstructing the prototype's history.

## Requirements

### Retention decisions

| Capability | Current implementation | Proposed treatment | Decision |
|---|---|---|---|
| Flow pattern | Shared pattern; MG24 adapter supplies tilt/stomp input | Preserve | Confirmed |
| Fire-trail pattern | Shared pattern; triggers on stomps | Preserve | Confirmed |
| Tilt fusion and stomp detection/strength | Pure math plus board-specific sensor readers | Keep pure math; use onboard sensor reader | Confirmed |
| Pattern selection and off | Prototype cycles with a D1 button | Replace the button with iPhone BLE controls | Confirmed. Capacitor app in FOX-269 |
| Left/right shoe configurations | Root Feather builds; old per-foot mount calibration | Retire; use one firmware and a common mount orientation | Confirmed |
| Per-foot pair flashing | `tools/flash-all.py` identifies Feather serial numbers | Retire the old per-foot selection tool; bulk flashing is not required | Confirmed direction |
| Color test and all-off firmware | MG24 PlatformIO `strip_test` / `strip_off` | Preserve | Confirmed |
| Motion calibration/debug build | Root Feather `imu_debug`; MG24 has calibration switches | Provide an MG24 diagnostic flow with iPhone feedback | Confirmed |
| Local bench CLI | `proto/xiao_mg24/mg24` Cobra launcher builds and flashes flag-configured tests | Preserve as a supported interface alongside the remote | Confirmed |
| Live brightness control | Build-time constants and prototype override | Expose brightness through the selected iPhone app | Confirmed |
| Neutral-position calibration | Compile-time mounting offsets | Add an app action to capture the boot's neutral pose | Confirmed |
| Remember settings | Prototype starts in flow; settings are compiled in | Restore per-controller pattern, brightness, and neutral offset | Confirmed |
| DC data-pin probe | MG24 standalone Arduino sketch | Retire | Confirmed diagnostic scope |
| Firmware-running indicator | Feather RGB NeoPixel; MG24 diagnostic LED | Use a simple MG24 running/error indicator | Proposed implementation detail |
| Native motion/geometry tests | `test/test_fusion/`, `test/test_strip_map/` | Preserve useful math tests; update layout cases | Proposed |

### Retirement inventory

- Feather-specific root PlatformIO target, platform, and dependencies.
- MPU-6050 sensor implementation and external-IMU bus/wiring settings.
- Feather onboard NeoPixel implementation, color settings, and pin fallbacks.
- Old Feather and GY-521 calibration values and hardware identification entries.
- Left/right build flags, per-foot offsets, per-foot build environments, and
  `tools/flash-all.py` with its Feather serial-to-foot mapping.
- D1/D6 button pin configuration, debounce/input handling, and button instructions.
- `proto/xiao_mg24/test_probe/`, the CLI's `probe` command, and their diagnostic
  instructions.
- FSR instructions still present in active wiring guides.
- `docs/wiring-mpu6050.md` and `.html`, and FeatherWing protoboard guides.
- Rewrite `docs/wiring.md`, replace the old extra-effort wiring reference with
  relevant MG24 guidance, and update `docs/power-budget.md` and open questions.
- Refresh `README.md`, `CONTEXT.md`, and agent orientation in `CLAUDE.md`.
- Consolidate the prototype into the main source tree; remove prototype wrapper
  translation units and the Arduino CLI workflow once the retained app,
  diagnostics, and `cli` tool work under the chosen PlatformIO toolchain. The CLI
  moves with the prototype and is not retired with it.
- Preserve architectural decision history, clearly distinguishing historical
  hardware details from current setup instructions. Do not maintain a parallel
  supported legacy hardware guide.
- Record that BLE app control is now in scope, superseding the old scope guardrail
  that excluded all wireless features. Shoe synchronization remains out of scope.

These are proposed file-level changes, not authorization to start deleting files.

## UX / Interaction Notes

- The tested strip data connection is D10 (PA5). No physical button is required.
- Keep total connected pixels distinct from pixels illuminated by a diagnostic.
  Color and off diagnostics must send black to all inactive connected pixels.
- Select flow, fire-trail, and off from the iPhone BLE remote. FOX-269 tracks the
  app and its MG24 integration.
- Restore the last selected pattern, including off, after a power cycle. Restore
  brightness and neutral calibration from the same controller's saved settings.
- A phone disconnect keeps the current pattern and brightness running. Reconnecting
  reports current state without resetting it. The app is not required to keep
  the LEDs or motion processing running after initial setup.
- Provide a brightness slider and a **Calibrate neutral** button in that remote.
- Describe all-off accurately: blanking the strip does not disconnect its power.
- Make motion calibration usable through the selected iPhone debugging workflow.
- The same firmware and controller orientation must give the intended motion
  response on both mounted shoes, without per-foot firmware selection.

 ### remote control app and interface

**App choice: a custom iPhone app built with Capacitor**, tracked in FOX-269. The
controls below describe what the remote needs to do.

| Remote control | Firmware action |
|---|---|
| Pattern buttons, listed by the boot | Select that pattern and remember it |
| On/Off toggle button | turn light strip on and off      |
| Brightness slider | Update brightness and coalesce saved changes |
| Calibrate buttons | Capture a stable neutral, heel, or toe pose for this controller |
| Identify button | Blink the strip to show which boot this is, changing no settings |
| Debug output switch | Enable/disable bounded motion/status notifications |
| Status screen | Report the actual settings, calibration, and sensor state |

- Define firmware commands and status responses for the controls above
  (`docs/remote-protocol.md`). Verify the BLE interface against the app in FOX-269.
- Identify each controller independently and report its actual settings on
  reconnect. Keep acknowledgements and motion telemetry bounded.
- Confirm the iOS BLE integration and document how to run the custom remote.

### Local bench CLI

The `cli` bench tool is a supported control and debug interface in addition to
the remote. Use it for bench tests and debugging from a computer; use the remote
for live control of a running shoe.

| CLI command | What it does |
|---|---|
| `flow` | Run flow with simulated tilt/impacts or `--motion` sensor input |
| `fire-trail` | Run fire-trail on timed impacts or `--motion` sensor input |
| `color` | Cycle colors or show a fixed color on `--lit` pixels |
| `off` | Blank every connected pixel |

- Keep its options for strip length, brightness, ring layout, build-only, and
  dry-run. Flags apply to that test build and don't rewrite saved firmware settings.
- With several boards connected, `--port`/`--serial` must select the board, and
  an upload must never go to a different connected shoe.
- Keep `--log-motion` for motion logs. The board's USB port carries the sketch's
  serial output in both directions, so these logs need no UART adapter.
- Each command currently builds and flashes a test image. Changing settings on
  running firmware without a reflash remains the remote's job.
- Name and document it as a supported tool rather than a temporary launcher.

### Neutral calibration

1. The user holds the boot still in the desired neutral position and taps
   **Calibrate neutral** for that connected controller.
2. Firmware reports capture in progress, samples a short stable window, and records
   the average resting fore-aft angle as the zero offset.
3. On success, firmware applies and saves the offset, reports success, and exposes
   a tilt reading near zero while the boot remains in the captured pose.
4. Reject captures with significant motion, no fresh sensor samples, or an
   unavailable sensor. Report a useful reason and retain the previous valid offset.

The app plan added heel and toe poses, captured the same way while wearing the boot
(`calibrate heel`, `calibrate toe`). Tilt then maps heel to -1, neutral to 0, and toe to +1,
and direction comes from those poses. A skipped side uses a 30° default, so neutral alone
still works. Poses don't change the strip's toe/heel positions or tune stomp thresholds.
Do not automatically recalibrate at startup, since a boot may be tilted then.

The implementation must document its sampling window, stillness bounds, timeout,
and accepted neutral-angle tolerance. These numeric values require bench tuning,
not additional product-scope decisions.

## Technical Design

Proposed approach:

1. Promote the tested MG24 hardware implementation into the main firmware, keeping
   patterns independent from pins and sensor-library details. A multi-board
   abstraction is unnecessary once the old board is retired.
2. Keep the motion service's useful contract and pure fusion/stomp math; replace
   its MPU-6050 reader with the onboard-sensor implementation and explicit units.
3. Consolidate WS2812 signaling used by the app, color test, and off build into one
   driver, removing misleading library-name shadowing and duplicate low-level drivers.
4. Select and pin one MG24 platform/core. The existing Arduino CLI and PlatformIO
   paths use different core versions; a successful upload alone is insufficient
   validation of the full app.
5. Define app and diagnostic modes at the root. Final environment names depend on
   the retained features; avoid parallel prototype and production settings.
6. Configure strip count, toe/heel positions, brightness, and common mount axes/signs.
   The old 40-pixel toe/heel positions and GY-521 mount signs are not measurements
   of the new strip or MG24 shoe mounts. Neutral offsets are captured and stored
   per controller, using the same firmware and axis configuration on both shoes.
7. Confirm the BLE interface and MG24 stack against the remote in FOX-269.
8. Continue consolidating bench diagnostics and motion firmware while the
   remote is built. Verify the remote before the full migration sign-off.
   Move the `cli` tool to the pinned toolchain and consolidated source paths as
   part of this work; it currently stages prototype files and calls Arduino CLI.
9. Add per-controller settings storage with validation and a versioned record.
   Save settings when user changes are accepted, with coalescing for rapid slider
   updates; do not write flash on every animation frame or telemetry sample.
   Acknowledge save failures without claiming settings will survive a reboot.

## Data Model and Interfaces

- Retain normalized fore-aft tilt, one-consumption stomp events, and stomp strength.
- Keep source units explicit: acceleration in m/s² and rotation in rad/s at the
  boundary with the shared motion math.
- Separate connected strip length, diagnostic lit length, ring layout, and
  brightness; establish valid bounds for each.
- Use common MG24 mount axes/signs for both consistently oriented controllers,
  with a separately captured neutral offset stored on each device. Do not copy
  the old board's foot-specific offsets or signs.
- Persist a stable pattern identifier (flow, fire-trail, or off), brightness,
  neutral offset/calibration validity, and settings format version. Do not store
  only an array index whose meaning changes if the pattern list is reordered.
- Validate saved values and fall back to documented conservative defaults if
  settings are absent, invalid, or unsupported. Recommended first-use defaults
  are flow, brightness 45/255 (70% of the remote's cap of 64), and zero neutral offset with an uncalibrated status.
- Debug status exposes active pattern, brightness, connection/sensor readiness,
  tilt and stomp information, calibration state, and whether settings saved.
- Document phone commands and status/debug responses in `docs/remote-protocol.md`.
  Keep parsing and debug output bounded so they do not block sensor sampling or animation.

## Risks and Mitigations

- **Mechanical contacts:** the reported dark-strip incident was resolved by
  seating the board fully in the breadboard. Include connector/continuity checks
  in troubleshooting rather than treating the incident as confirmed chip damage
  or a confirmed toolchain failure.
- **Timing/toolchain differences:** exercise the actual color/off and motion app
  under the pinned PlatformIO setup before removing the working prototype path.
- **Changed strip density:** validate new strip geometry and animation timing;
  changing pixel count alone does not preserve physical positions or trail speed.
- **Power:** replace generic old-strip estimates with guidance for the chosen
  BTF strip and tested setup. A boot's 69 cm is rated about 5.5 W, or 1.1 A at full white.
  Validate USB bench and external-5V operation as distinct profiles. Final battery design
  is outside this migration.
- **Same firmware, two shoes:** identical controller orientation is the intended
  mounting constraint, not a reason to skip toe-down/heel-down checks on each shoe.
- **Independent settings:** the phone must identify which controller it is connected
  to. Calibrating or changing one boot must not implicitly change the other.
- **Neutral capture and storage:** an unstable or failed capture must not replace
  valid calibration. Reboot and save-failure checks are required for the settings
  that the product promises to remember.
- **Bluetooth and LED timing:** CPU-timed pulses proved unreliable with the Bluetooth
  stack in the build, even with interrupts off, so the strip driver now generates its
  signal with SPI and DMA. Verify motion, animations, and bidirectional BLE commands
  together at the configured strip length.
- **Calibration visibility:** complete the iPhone feedback path with clear behavior
  if the motion sensor is unavailable.

## Rollout and Migration Plan

1. Record the accepted scope and the initial firmware/configuration defaults.
2. Make root PlatformIO color/off modes run on the chosen board and strip using
   shared settings and driver code.
3. Port the retained motion-driven app and diagnostics. Recalibrate the new mount
   and strip layout, and confirm the retained interactions on hardware.
4. Complete FOX-269 and document BLE commands and motion/status feedback,
   brightness, neutral capture, and settings persistence.
   Validate them together while the retained patterns run.
5. Remove retired hardware code/dependencies and redundant prototype paths, after
   the `cli` tool runs on the pinned toolchain. Rewrite
   current guides and update decision/agent documentation to the final behavior.
6. Validate both mounted shoes with the same firmware under the supported power
   setups. Review current instructions as a new reader. Battery/enclosure design
   can remain follow-up work, but a bench-only demo does not complete migration.

## Testing Plan

Planning only: no builds, flashes, or validation commands have been run for this
migration. Proposed checks during implementation:

- Build every retained firmware environment with the pinned PlatformIO tools.
- Retain native motion/geometry checks; add meaningful new-layout cases where needed.
- On hardware, check colors, inactive-pixel blanking, all-off, reboot behavior,
  tilt direction, single stomp events, and iPhone pattern/off and brightness controls.
- Test sensor-unavailable behavior and the chosen firmware-running/error indicator.
- Test both mounted shoes with the same firmware and mounting orientation.
- Run every retained `cli` tool command on hardware, including board selection with
  two controllers connected and `--log-motion` over USB.
- Test the chosen remote's controls, debug output, button releases/repeats, disconnects, and reconnects
  while animations and motion processing are active.
- Capture neutral on each mounted boot and verify near-zero tilt, correct
  toe-down/heel-down response, and rejection of moving/unavailable-sensor captures.
- Power-cycle each controller and verify restoration of pattern (including off),
  brightness, and its own neutral offset. Test missing/invalid settings and failed
  saves without overwriting a valid calibration.
- Verify a slider burst does not cause a flash write for every received update.
- Check USB bench and external-5V operation against their documented brightness
  and strip-length settings. Final battery validation is excluded.

## Acceptance Criteria

Scope agreed; physical and protocol details are resolved by the implementation
deliverables below:

- Root commands build and upload the selected MG24 app and every retained diagnostic.
- Every retained animation and interaction works on the actual BTF FCOB strip.
- Both mounted shoes run the same firmware with correct motion behavior and no
  left/right configuration or physical pattern-cycle button.
- The remote can change patterns and select off without reflashing, adjust
  brightness, trigger neutral calibration, and supply usable motion/status
  debugging as specified in FOX-269.
- Power-cycling each shoe restores its own selected pattern, brightness, and
  neutral calibration. Both shoes still run the same firmware binary.
- A neutral capture produces near-zero tilt in the held pose within the documented
  tolerance. Moving or failed captures leave the previous calibration intact.
- Disconnecting the phone does not reset the active settings or stop the pattern;
  reconnecting can inspect and control the current state.
- Document how to set up and use the chosen remote.
- The `cli` tool runs flow, fire-trail, color, and off on the actual hardware from
  the pinned toolchain, selects the intended board, and is documented as a
  supported interface alongside the remote.
- Color, all-off, and motion-calibration diagnostics remain supported; the DC
  probe is removed from supported modes and current instructions.
- One documented configuration controls the current pins, strip layout, brightness,
  and calibration without prototype overrides.
- Current setup instructions contain no supported Feather, MPU-6050, FSR, or
  FeatherWing assembly path, per-foot firmware selection, or physical-button
  requirement; historical decision notes are clearly historical.
- Retired libraries, board targets, hardware fallbacks, and duplicate sketches are
  removed only after the replacement's relevant hardware checks pass.
- README setup/run commands match the tested implementation and expose known limits.

## Open Questions

The remaining items cover implementation and assembly work.

1. Settle the cut point and physical ring layout per shoe, recording pixel count and
   toe/heel positions. The boot measures about 69 cm, or about 110 pixels at 160 per
   meter. Keep these configurable until assembly is fixed.
2. Build the Capacitor app in FOX-269 and verify it with the MG24.
3. Tune the neutral-capture sample window, stability criteria, timeout, and tilt
   tolerance on the actual mounted hardware; document the chosen values.
4. Define and verify sensor-failure behavior. Recommended default: expose a visible
   error and phone status, keep off accessible, reject neutral capture, and report
   unavailable motion without generating stomp events.
5. Validate the proposed first-use defaults against the USB bench configuration;
   document the supported brightness/length limits for each tested power setup.

## Related Work

- [FOX-271 — Migrate Firewalker to the MG24 Sense and BTF FCOB strip](https://linear.app/foxyblocks/issue/FOX-271) (tracking ticket)
- [FOX-269 — Capacitor iPhone app](https://linear.app/foxyblocks/issue/FOX-269), which replaced [FOX-266](https://linear.app/foxyblocks/issue/FOX-266)
- [FOX-270 — Add a TUI to the mg24 bench CLI](https://linear.app/foxyblocks/issue/FOX-270)
- [Seeed MG24 Bluetooth guide](https://wiki.seeedstudio.com/xiao_mg24_bluetooth/)

## Appendix

Evidence inspected: root firmware/configuration, both pattern implementations,
motion and ring-mapping helpers/tests, `tools/flash-all.py`, active hardware guides,
ADRs 0001–0003, and the MG24 prototype and diagnostics. The hardware choice and
breadboard-contact diagnosis are based on Christian's confirmation in this chat.
