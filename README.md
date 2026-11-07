# Firewalker Shoes

Wearable LED-shoe firmware, inspired by Adafruit's Gemma LED Sneakers / Firewalker
guide. Built with **PlatformIO + Arduino framework**.

Each shoe is a Seeed Studio XIAO MG24 Sense driving one addressable LED strip. The
board's onboard motion sensor drives two patterns:

- **flow**: the strip shares one hue that slowly rotates through the spectrum and
  "pools" toward whichever end of the foot tilts down. A stomp launches trails from
  the down-point, or flashes the strip white if the foot is level.
- **fire-trail**: each stomp launches fire-gradient bands from whichever part of the
  boot is down. They run along both sides of the foot to the opposite part, or outward
  from the middle if the foot is level, and several can stack at once.

Both shoes run the same firmware. Each one remembers its own pattern, brightness, and
calibrated poses across power cycles, and can be controlled without reflashing
from an iPhone app over BLE or from a computer over USB.

## Hardware

| | |
|---|---|
| Board | Seeed Studio XIAO MG24 Sense |
| Motion sensor | Onboard LSM6DS3TR-C, no wiring needed |
| LED strip | BTF-LIGHTING FCOB-5V-160L-W-IP30-SPI-5MM: 160 RGB pixels per meter, 5 V, XGB1338 (WS2812B-compatible). A boot uses about 69 cm, or about 110 pixels |
| Data pin | **D10** to the strip's DIN, at the input end. D8 and D9 must stay unconnected |
| Status light | Onboard LED: solid when running, slow blink if the sensor is missing, fast blink while calibrating |
| Power | USB for bench work, or a dedicated 5 V supply for the strip. See [`docs/power-budget.md`](docs/power-budget.md) |

Wiring is in [`docs/wiring.md`](docs/wiring.md).

## Quick start

You need [PlatformIO Core](https://docs.platformio.org/page/core/installation/index.html).
The first build downloads the board platform and Arm's compiler (about 200 MB).

```bash
pio run                        # build the app
pio run -e final_app -t upload # flash it
pio device monitor             # open the USB console at 115200 baud
```

With both shoes plugged in, an upload refuses to guess which one you meant. Find each
board's serial number and name it:

```bash
pio device list
pio run -e final_app -t upload --upload-port 572C60FA
```

## Controlling a shoe

Type commands into the USB console, or send the same commands over BLE:

```text
status
patterns
pattern fire-trail
pattern off
brightness 32
calibrate neutral
calibrate heel
calibrate toe
identify
debug on
```

Replies are JSON lines. [`docs/remote-protocol.md`](docs/remote-protocol.md) has the
full reference, including the BLE service an iPhone app connects to. The app itself is
tracked in [FOX-269](https://linear.app/foxyblocks/issue/FOX-269).

To calibrate a boot, wear it and hold each pose while you send its command: first
`calibrate neutral` at rest, then optionally `calibrate heel` and `calibrate toe`. The
firmware samples for two seconds and maps those poses to tilt -1, 0, and +1 from then on. A
little wobble is fine. A skipped side reaches full tilt 30 degrees from neutral. If the boot
never settles or a pose can't work, it reports why and keeps the previous calibration. Do
this once per boot.

## Bench tool

`./cli` lists USB-connected boots, installs firmware, identifies hardware, and runs live or
headless diagnostics. It needs [Go](https://go.dev); installing firmware also needs PlatformIO.
Diagnostics observe the running app and restore its debug setting when they finish. They do
not change saved microphone tuning, poses, brightness, patterns, or strip layouts.

### Commands and boot selection

```bash
./cli list                              # IDs, USB serials, ports, and firmware status
./cli list --json                       # machine-readable inventory
./cli identify ABCD                     # blink this boot's strip
./cli identify --boot ABCD,EF12          # blink several boots without a menu
./cli install ABCD                      # build and install this checkout's shoe app
./cli install --all                     # install on every connected boot
./cli install --build-only              # compile without selecting or touching hardware
./cli debug ABCD                        # live motion and microphone dashboard
./cli debug audio --boot ABCD           # speaker tones, measurements, and PASS / FAIL
./cli debug motion --boot ABCD          # finite IMU capture check
./cli debug --headless --boot ABCD      # audio and motion checks together
```

`install`, `identify`, and `debug` accept positional identifiers or `--boot`. An identifier
can be a four-character boot ID, its USB serial, or its current port path. Repeat `--boot`,
use commas, or provide several positional identifiers to select several boards. `--all`
selects every connected board explicitly. Unknown or ambiguous identifiers fail before
anything runs; repeated identifiers act on that board once.

With no identifier, a terminal shows a selection menu: **↑ / ↓** move, **Space** toggles each
boot, and **Enter** runs the command on the checked boots. **a** toggles all, and **Esc** cancels.
The `identify`, `debug audio`, and `debug motion` menus stay open after each run, retaining
the checked boots and results. Press **Enter** again to repeat, or **q / Esc** to close.
During a run, Enter does not start overlapping actions; quitting cancels and cleans up.
Nothing is selected automatically, including when only one board is connected. Scripts must
supply identifiers or `--all`; `--headless` also prevents a menu when running in a terminal.
`list` includes connected boards that cannot answer, using a clearly marked remembered ID
when available, so a bench build can still be selected for reinstalling.

### Live diagnostics

`./cli debug` opens the selector and then a dashboard for the selected boots. Each boot shows
its firmware protocol, calibration state, tilt, angle, acceleration, rotation, stomp count,
and microphone level, raw RMS, ADC range, sample counter, and capture timing. History graphs
and the age of each report make changing or stale readings visible.

| Key | Action |
|---|---|
| `Tab` | Focus the next boot |
| `i` | Identify the focused boot |
| `Space` | Pause and release the USB connections |
| `r` | Reconnect the selected boots |
| `l` | Show or hide recent firmware output |
| `↑` / `↓` | Scroll |
| `q`, `Esc`, `Ctrl-C` | Exit and restore debug streaming |

The shared inactivity limit in `config/control-surfaces.json` also pauses the dashboard.
Readings stay visible with their age. The first key after pausing reconnects; repeat an action
once the board is connected. A live connection owns its USB port, so pause or exit before
opening another serial tool.

### Headless checks

```bash
./cli debug audio --boot ABCD,EF12 --json
./cli debug motion ABCD --duration 5s --require-movement
./cli debug --headless --all --json
```

Audio plays **1 kHz and 2 kHz tones** through the computer's current sound output, with quiet
windows before, between, and after them. Put the boards near the speakers and pause other
audio. Every selected board is sampled during the same tones. The default window is two
seconds; `--duration` sets each window's length. Playback startup silence is excluded from
the measured tone window.

A microphone passes when both tones produce at least **3× the preceding background RMS**
and an increase of **8 raw RMS counts**, with at least five readings per window, advancing
capture counters, and no ADC clipping. The test uses raw signal strength, so saved sensitivity
and the recipe's noise gate do not determine the result. `--min-ratio`, `--min-rise`, and
`--volume` adjust the bench check; system volume and output-device settings stay unchanged.
This is an acoustic response check, not a calibrated sensitivity measurement.

Motion checks require available, plausible IMU readings. A stationary boot can pass capture;
`--require-movement` also requires a change in tilt, angle, acceleration, rotation, or a stomp.
Diagnostics report every selected boot even if one fails. Exit status is **0 for all PASS**, or
**1 for a failed check or execution error**. `--json` writes results to stdout and phase
progress to stderr. Debug settings are restored and ports close before results return.

Sound playback uses `afplay` on macOS, `paplay` / `aplay` on Linux, or PowerShell's SoundPlayer
on Windows; `ffplay` is a fallback. A missing or failed player is reported as an execution
error rather than a microphone failure.

### Installing firmware and strip tests

`install` defaults to `final_app`. `--firmware` selects `imu_debug`, `strip_test`, or `strip_off`.
Application installs check the selected boots before the first upload and refuse a known
protocol downgrade: use the matching/newer checkout, or `--allow-downgrade` for an intentional
replacement. Uploads preserve the stored flash settings; an older app may not understand them.
`--dry-run` prints the build settings without compiling or uploading.

The one-off strip tests live under `install` because they replace the running firmware:

```bash
./cli install flow ABCD --brightness 16
./cli install flow ABCD --tilt=-0.5
./cli install flow ABCD --stomp-every 2s
./cli install flow ABCD --motion --log-motion
./cli install fire-trail ABCD --motion
./cli install color ABCD --color '#ff8000' --lit 10
./cli install off ABCD
./cli install flow --build-only
```

Pattern tests use each selected boot's saved strip layout, then its remembered layout, then
`include/config.h`. `--pixels`, `--toe`, and `--heel` override that test without changing saved
settings. Color/off tests use the configured length; `--lit` sets the lit prefix for color.
`--motion` cannot be combined with simulated `--tilt` or `--stomp-every`.

`--follow` (also accepted as the hidden `--debug` alias) streams output after a single-board
install. `--log-motion` does the same for a motion-driven strip test. Install multiple boots
first, then use `debug` for the app's multi-boot dashboard. `off` blanks pixels but leaves
their idle power draw; unplugging the strip removes power.

### Firmware bench TUI and compatibility

`./cli bench`, or bare `./cli` in a terminal, opens the firmware bench TUI. It keeps the test
forms, build selection, boot information, raw protocol console, and searchable logs. `1`, `2`,
`3`, and `5` select screens; `p` picks a boot, `a` installs the app, `:` opens the protocol
console, and `q` exits. Its displayed shell commands use the `install` hierarchy.

Older top-level `app`, `flow`, `fire-trail`, `color`, and `off` commands remain hidden aliases
for existing scripts. `./cli web` still serves the phone remote; `./cli web --fake` uses
pretend boots.

## Tests

Pure logic runs off-hardware, so it needs no board:

```bash
pio test -e native
(cd tools/cli && go test ./...)
```

Lit LEDs still need eyes on the real strip: a successful compile or upload doesn't
verify the signal.

## ⚠️ Power safety

Brightness scales requested color. It isn't a current limit. By its rating, the strip can
pull about 1.1 A at full white once cut to a boot's 69 cm, or 1.6 A uncut. Each boot's soft
cap holds brightness at 96, so a USB-fed boot strip of up to 107 pixels stays near 400 mA at
full white, under a USB 2.0 port's 500 mA. The remote's Cap toggle turns it off, and then
brightness goes to 255, about 1.07 A at full white on 107 pixels. Before turning the cap off,
read [`docs/power-budget.md`](docs/power-budget.md) and use a dedicated 5 V supply with
grounds tied together.

## Known limits

- A boot starts from the uncut 160-pixel strip, with bench toe and heel positions (52 and 132).
  It needs about 110 pixels, so set each boot's count, toe, and heel from the iPhone remote's
  Calibrate sheet once its strip is cut. See [`docs/open-questions.md`](docs/open-questions.md).
- Battery and enclosure design are still open.
- BLE has no pairing, so anyone nearby with a BLE app can connect and change a shoe's
  settings.

## Project conventions

- Hardware knobs live in [`include/config.h`](include/config.h).
- Settings shared by the remote, designer, and CLI live in [`config/control-surfaces.json`](config/control-surfaces.json). Connections pause after two minutes without input; see [`config/README.md`](config/README.md) to change or disable the timeout.
- Domain language: [`CONTEXT.md`](CONTEXT.md). Decisions: [`docs/adr/`](docs/adr).
- Agent, Linear, and triage setup: [`AGENTS.md`](AGENTS.md) and `docs/agents/`.

## iPhone remote

`app/` is the iPhone app that controls the boots over Bluetooth, and its
[README](app/README.md) covers running, testing, and installing it. It works with no network.

To run it in a browser on this computer, use `./cli web`. It needs [Bun](https://bun.sh).

```bash
./cli web              # install, build, serve at localhost:5173, and open a browser
./cli web --dev        # the hot-reload dev server, with no build
./cli web --fake       # open with pretend boots, for working without hardware
./cli web --no-open    # print the address instead of opening a browser
./cli web --build-only # build and stop
```

Ctrl-C stops the server. Real boots need Chrome or Arc, because Safari has no Web Bluetooth. It
always uses port 5173, and stops if something else is using it, because a browser keeps boot
labels and Bluetooth permissions per port.

## Pattern designer

`designer/` is a web app for designing new patterns as recipes on a computer. It simulates
the boot from above and from the side, with a tilt slider and a stomp button, and saves
recipes to [`patterns/`](patterns). Its [README](designer/README.md) covers running it, and
[`docs/recipe-format.md`](docs/recipe-format.md) is the format. Boots can't run recipes yet.
