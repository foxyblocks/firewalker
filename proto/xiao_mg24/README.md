# XIAO MG24 flow prototype

A hardware-evaluation branch: run the Firewalker **`flow`** pattern on a Seeed
**XIAO MG24 Sense** instead of the Feather RP2040 + GY-521. The XIAO MG24 is an
all-in-one board (Silicon Labs EFR32MG24 + onboard 6-axis IMU), so the question
is whether it can replace the two-board controller stack.

**Status:** CLI off, color, simulated flow, and timed fire-trail tests are
bench-confirmed on **D10 (PA5)** with the 160-pixel BTF strip (2026-11-02).
The signal-timing fix below removes the off-test blinking and stray pixels.
Motion-enabled flow's quick-tilt response is also visually confirmed with the
current mount after correcting the gyro direction (2026-11-02).

The full motion demo runs a slowly spectrum-cycling fill gauge that pools toward
the down-tilted end, with stomp-launched trails. The onboard LSM6DS3 drives the
fused tilt + stomp. A momentary button on **D1** cycles modes:
**flow → fire-trail → off** (and wraps).

## Hardware

| | |
|---|---|
| Board | Seeed XIAO MG24 Sense (EFR32MG24, Cortex-M33, USB serial# `572C60FA`) |
| IMU | Onboard **LSM6DS3TR-C**, I2C `0x6A` on the default `Wire` bus; enable pin **PD5** must be driven HIGH before `begin()` |
| LED strip | 160-pixel BTF FCOB WS2812B-compatible RGB, data on **D10** (PA5), V+ on 5V supply, common GND |

The confirmed strip is [Amazon ASIN B0CNXKSWD7](https://www.amazon.com/dp/B0CNXKSWD7),
model **FCOB-5V-160L-W-IP30-SPI-5MM**: approximately 1m / 3.2ft, 160 individually
addressable RGB pixels, 5V, 5mm wide, IP30. The listing identifies its controller
as **XGB1338 (WS2812B-compatible)**. The firmware uses the compatible three-byte
GRB data format and nominal 800kHz signaling, with the CLI defaulting to 160
pixels. It does not use an RGBW format or treat multiple LEDs as one pixel.

The motion demo drives all **160 pixels** at **16/255 brightness**. `build.sh`
supplies virtual ring positions **toe 52 / heel 132**, scaling the 40-pixel
layout by four to give two 80-step arcs. These are bench-demo coordinates,
not measured mounting points for a shoe. Brightness is `XIAO_BRIGHTNESS` in
`xiao_mg24.ino`; count and ring positions are `STRIP_FLAGS` in `build.sh`.

**Mode button:** momentary switch from **D1** to GND (internal pull-up, pressed =
LOW). Cycles flow → fire-trail → off. Each press logs `[firewalker] D1 pressed,
mode -> <name>` — but to the UART, not USB (see gotcha #4).

## Strip wiring and power

- **D10 (PA5) → strip DIN**, at the input end (arrows point away from the board).
- **GND → strip GND**. An external strip supply must share this ground.
- **Strip +5V → a 5V source**. With USB powering the XIAO, its 5V/VBUS pad
  exposes USB power and can supply a small strip test within the source and
  board's current limits. Seeed's [official pinout reference](https://www.seeedstudio.com/xiao-series-page/playground/pinout/?board=mg24)
  recommends keeping peripheral load **under 500mA**. This is general operating
  guidance, not a measured MG24 board-trace rating or a guarantee of available
  USB current; the source/cable and board's own consumption also matter. The
  5V pad is not a boosted battery output.
- For a long strip, feed it directly from an adequately sized 5V supply; keep
  the XIAO on USB and leave its 5V pad disconnected from that supply.
- The connected bench strip is approximately 1m / 160 pixels, with the XIAO
  powered by USB. BTF's matching [160-pixel FCOB specification](https://www.btf-lighting.com/products/fcob-rgb-addressable-led-strip-dc5v-160pixels)
  lists up to 8W/m at 5V (about 1.6A per meter). For full-strip operation, use
  a separate 5V supply rated at least 2A rather than assuming the board's USB
  pass-through supports that load.
- The standalone `test_calib` sketch lights only the first **4 pixels** at
  **16/255** intensity per channel and sends black to the remaining pixels of
  the 160-pixel strip. All 160 pixel controllers still draw idle current. The
  motion demo drives 160 pixels at 16/255 with the scaled virtual ring layout.
  Pixel count and brightness are software settings, not a current limiter.

## Temporary test CLI

From this directory, use the local Go/Cobra launcher. Each command compiles and
uploads its chosen test; all flags apply to that build without rewriting your
saved firmware settings. Data stays on **D10**. Defaults are **160 pixels** and
**16/255 brightness**.

```bash
./mg24 flow --pixels 160 --brightness 16              # flow with no sensor input
./mg24 flow --tilt=-0.5                               # fixed simulated heel-down tilt
./mg24 flow --stomp-every 2s                          # timed flashes/trails
./mg24 flow --motion                                 # onboard tilt and stomp input
./mg24 fire-trail --stomp-every 1s                    # repeat fire trails without motion
./mg24 fire-trail --motion                           # real stomps trigger fire trails
./mg24 color --lit 20 --brightness 16 --interval 500ms # cycle white/red/green/blue
./mg24 color --color '#ff8000' --lit 10                # fixed orange, other pixels black
./mg24 off                                          # blank all connected pixels
./mg24 probe                                        # hold D10 HIGH for a multimeter
./mg24 flow --build-only                             # compile without uploading
./mg24 flow --dry-run                                # display settings without building
./mg24 flow --help
```

`--pixels` is the total connected length; color tests use `--lit` to choose how
many to illuminate while sending black to all remaining pixels. Pattern builds
derive virtual toe/heel positions from strip length; `--toe` and `--heel` can
override them. Flow defaults to level with no impacts and does not compile or
initialize the sensor unless `--motion` is present. Fire-trail defaults to one
simulated impact per second without motion. Explicit `--stomp-every 0` disables
timed impacts. Motion cannot be mixed with simulated tilt or timed impacts.

The CLI needs Go and the existing `arduino-cli`/Silicon Labs core setup. It
builds a temporary sketch from the real pattern implementations and timed
MG24 strip driver. Its sources are in `cli/`. Unlike the old upload recipe, it
selects the discovered CMSIS-DAP probe by serial and verifies the upload. With
multiple boards connected, pass `--port /dev/cu.usbmodem…` or `--serial …`.
`--log-motion` requires `--motion` and logs through UART D12 TX, not USB.

Off blanks pixels while leaving power connected. Probe clears the strip and
then holds the data output at 3.3V; it is not an animation. Brightness settings
are not current limits; use the power guidance above for brighter tests.

## Toolchain

The standalone strip test uses Seeed's [MG24 PlatformIO platform](https://wiki.seeedstudio.com/xiao_mg24_with_platform_io/),
configured in this directory's `platformio.ini`. From the repository root:

```bash
pio run -d proto/xiao_mg24             # compile the standalone strip test
pio run -d proto/xiao_mg24 -e strip_test -t upload # compile, flash, and start colors
pio run -d proto/xiao_mg24 -e strip_off -t upload  # blank all 160 pixels
```

The off command sends black frames without changing your saved color-test
settings. It leaves the board and strip powered; unplug USB for a full power-off.

The first run installs the pinned Seeed platform and its toolchain. The test
settings are at the top of `test_calib/test_calib.ino`: `STRIP_PIXELS` is the
connected strip length, `TEST_PIXELS` is the number lit, and `TEST_LEVEL` is
channel intensity (0–255). This configuration compiles only the standalone
strip test. The root PlatformIO configuration targets the Feather RP2040.

The full motion-driven MG24 demo uses `arduino-cli` + the Silicon Labs core.
One-time setup for that demo (already done on this machine):

```bash
brew install arduino-cli
arduino-cli config add board_manager.additional_urls \
    https://siliconlabs.github.io/arduino/package_arduinosilabs_index.json
arduino-cli core update-index
arduino-cli core install SiliconLabs:silabs
arduino-cli lib install "Seeed Arduino LSM6DS3"
# Do NOT install "Adafruit NeoPixel" — it fails to compile on the gecko core
# (#error Architecture not supported). This sketch ships its own compat shim.
```

## Build / flash the full motion-driven demo

```bash
proto/xiao_mg24/build.sh            # compile only
proto/xiao_mg24/build.sh --upload   # compile + flash the detected port
```

FQBN: `SiliconLabs:silabs:xiao_mg24:protocol_stack=none` (plain Arduino, no
Matter/BLE — smallest, fastest). Upload is **openocd over SWD** via the XIAO's
onboard **CMSIS-DAP** USB interface — no BOOTSEL/UF2, no 1200bps touch, no manual
reset. The board self-programs over its normal USB port.

## How it's wired up (no fork of the flow logic)

The flow stack splits into board-agnostic (reused verbatim) and board-specific
(this dir):

- **Reused unchanged** from the main firmware, compiled straight from `include/`
  and `src/` via `-I` include paths (see `build.sh`):
  - `src/patterns/flow.cpp` — the pattern + its engine (pulled in by
    `src/flow_unit.cpp`, a one-line `#include`).
  - `include/firewalker_fusion.h` — complementary filter + stomp hysteresis.
  - `include/firewalker_strip_map.h` — strip ring geometry.
  - `include/config.h` — flow knobs + IMU thresholds (FLOW_*, IMU_STOMP_*, etc.).
- **Board-specific** (here):
  - `Adafruit_NeoPixel.h` — a compat shim. The flow pattern is written against
    the Adafruit_NeoPixel API; this is a minimal drop-in backed by a built-in
    WS2812 GPIO bit-bang. With the real library uninstalled and this dir on the
    include path, `#include <Adafruit_NeoPixel.h>` resolves here.
  - `src/imu_xiao.cpp` — the LSM6DS3 service implementing the shared
    `Firewalker::imu*` contract (`firewalker_imu.h`), reusing the fusion math.
  - `src/xiao_strip.cpp` — defines `Firewalker::strip` on D10.
  - `xiao_mg24.ino` — setup/loop wiring it together.

## Gotchas discovered during bring-up (the important part)

These cost real time; read before touching this again.

1. **Adafruit_NeoPixel does not compile on the gecko core** (`#error Architecture
   not supported`). The silabs core ships `ezWS2812gpio`, but see #2. We use a
   compat shim with our own bit-bang instead, so `flow.cpp` runs unmodified.

2. **`getCPUClock()` misreports the clock**, so any WS2812 driver that derives
   bit-timing from it (the bundled `ezWS2812gpio`, and our first attempt) emits
   high-pulses that are too short — every bit reads as 0 and **the strip stays
   completely dark**. Fix: the shim **measures the real CPU frequency at runtime**
   by counting DWT cycles across a 100 ms `millis()` window (millis() stays
   accurate regardless of CPU clock), then derives timing from that. This was the
   single biggest time sink — the strip was dark with correct wiring.

3. **The WS2812 output uses explicit port/bit writes.** The Arduino strip
   object selects **D10**, and the shim sends pulses on **PA5** (`gpioPortA`,
   bit 5). Keep both aligned when moving the data pin. Deriving the port/mask
   incorrectly during bring-up left the output steady HIGH instead of sending
   data, producing solid white. Both diagnostic sketches also use D10.

4. **`Serial` is a hardware UART (EUSART0 on pins D11/D12), not USB CDC.** The
   single USB port is the CMSIS-DAP debug interface and does **not** carry the
   sketch's UART. So `Serial.print` is invisible over USB — there is no USB serial
   logging on this board without an external UART adapter. `imu_xiao.cpp` still
   prints (harmless); just don't expect to read it over USB.

5. **WS2812 bring-up order that actually isolates faults:** onboard LED heartbeat
   (sketch alive?) → runtime-calibrated bit-bang (`test_calib`, timing) → DC probe
   (`test_probe`, wiring/level with a multimeter). 3.3 V data into a 5 V strip
   worked with the previous bench strip; a different strip may need a 3.3V-to-5V
   logic level shifter.

6. **Keep the cycle-counter anchor before the data-HIGH write.** Both the
   shared driver's `sendByte_()` and the standalone test's `wsByte()` start
   timing before choosing the pulse width and raising D10. Moving that read
   after the HIGH write produced visibly corrupt frames: even `./mg24 off`
   blinked while sending only zeros. Restoring the order made off steadily
   dark with unchanged wiring, but mixed-color frames still showed stray
   downstream pixels because the compiler hoisted the shared driver's timing
   member loads ahead of the counter read. The empty assembly memory barrier
   after the read keeps those loads inside the measured interval; disassembly
   confirmed the corrected order, and the CLI's four-pixel color cycle then
   kept the other 156 pixels black. The barrier emits no CPU instructions.
   Treat this order as part of the pulse timing, and check black, fixed colors,
   and animations on the actual strip after changing either driver. A
   successful compile/upload does not verify LED signaling.

   **Hardware regression checks (2026-11-02):** Christian confirmed steadily
   dark off, a clean four-pixel white/red/green/blue cycle with the other 156
   pixels dark, smooth flow with simulated tilt and impacts every two seconds,
   and clean fire-trail bands with timed impacts every second. Color and
   animation tests used brightness 16/255; the strip was powered from USB VBUS.

## Diagnostic sketches

Self-contained, no repo includes. Build with e.g.
`arduino-cli compile --fqbn SiliconLabs:silabs:xiao_mg24:protocol_stack=none test_calib`.

- **`test_calib/`** — reference WS2812 bring-up. Self-calibrating bit-bang (the
  approach the shim uses), cycles white/R/G/B on the first four pixels at
  16/255 intensity and blanks the other 156. Blinks the onboard LED ~MHz/10
  at boot so you can read the measured clock. Start here for a small-load test.
- **`test_probe/`** — holds D10 HIGH (DC) + onboard LED solid, for multimeter
  checks of pin output / data continuity / strip power.

## IMU axis calibration

`include/firewalker_mg24_mount.h` owns the MG24's mount axes, signs, and neutral
trim, separately from `config.h`'s Feather GY-521 map. The motion service and
native fast-rotation tests use this same mapping: **fore-aft = +accel X**, **up =
+accel Z**, and **pitch rate = -gyro Y**.

The negative gyro sign matters during quick movement. With this X/Z angle,
positive rotation around sensor Y decreases `atan2(accel X, accel Z)`. Using
+gyro Y makes the prediction move the wrong way, leaving the accelerometer to
correct the angle slowly afterward. The regression tests replay fast rotations
in both directions and require tracking during movement, not eventual settling.
Run them with `pio test -e native -f test_mg24_mount` from the repo root.

**Hardware check (2026-11-02):** Christian confirmed that
`./mg24 flow --motion --brightness 16` follows quick back-and-forth tilts
promptly with this mapping. The fast-rotation replay tests fail with +gyro Y
and pass with -gyro Y; all 23 native tests pass. This validates the current
bench mount's tilt response, not calibration for a different shoe mount.

**If you remount the board, re-check the axis mapping and neutral trim.** Check
both static toe-down/heel-down pooling and quick movement. Neutral trim changes
the resting zero; it does not repair an incorrect gyro direction. There is no
USB serial motion log on this board, so use the visual flow response or a UART
adapter on D12 for `./mg24 flow --motion --log-motion`.

## Not done / open

- IMU mount map is hand-confirmed for one orientation, not bench-measured across
  remounts.
- The D1 press log goes to the UART only (no USB serial on this board), so it's
  not visible without a UART adapter on D12.
- Power/current at the chosen brightness (`XIAO_BRIGHTNESS` in the `.ino`) not
  measured on 40 px.
