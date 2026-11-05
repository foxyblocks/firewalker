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

`./cli` flashes a boot, runs debug tests, and shows what the firmware says. It needs
[Go](https://go.dev) and PlatformIO. Bench tests never change firmware settings or a shoe's
saved settings. Pattern, brightness, calibration, and the strip layout all stay on the iPhone
remote.

### The TUI

Run `./cli` with no arguments to open it. Piped or scripted, it prints help instead.

The board bar across the top lists every boot on USB and each one it has seen before, with a
tag for what's running: `app` if it answered `status`, otherwise what this tool last flashed
(such as `bench flow`), or `unknown`. A lone boot is picked for you. With two, nothing flashes
or sends until you press `p` and pick one.

| Key | Screen | What it's for |
|---|---|---|
| `1` | Bench test | Every test below as a form, on the boot's real strip layout, with the matching `./cli` command. `←` `→` change a value, `e` types one, `Enter` flashes, and `b` only builds |
| `2` | Builds | Whole firmware: the app, `imu_debug`, `strip_test`, and `strip_off` |
| `3` | Boot | What the running app reports about itself. `r` refreshes, `i` blinks the strip, and `d` turns motion lines on or off |
| `5` | Log | The whole log. `r`, `f`, `m`, and `b` show or hide replies, firmware logs, motion, and build output. `/` searches, `space` pauses, and `↑` `↓` scroll |

These work from any screen:

| Key | Does |
|---|---|
| `tab`, `shift+tab` | Next or previous screen. The number keys jump straight to one |
| `p` | Pick a boot from a list of each one's id, USB serial, and tag |
| `a` | Flash the app to the picked boot. Its saved settings stay |
| `A` | Flash the app to both boots, one after the other, after one confirm |
| `:` | Send any protocol line to the boot, with tab completion and history |
| `l` | Cycle the log pane: small, half, hidden |
| `ctrl+j`, `ctrl+k` | Scroll the log down or up. Page keys work too, on keyboards that have them |
| `?` | Show help |
| `q` | Quit and leave the board running |

Every flash names the boot and waits for `Enter`. The stage line then shows building, uploading,
and running or failed, with build output in the log and the reason for a failure pinned above
it. Afterward the TUI stays attached, so the firmware's output keeps streaming.

The TUI holds the boot's USB port while it's open, so `pio device monitor` can't attach until
you quit or pick another boot.

### Subcommands

Each test is also a subcommand, for scripts and repeat runs:

```bash
./cli app                                              # flash the app; saved settings stay
./cli app --debug                                     # same, then stream the board's output
./cli flow --brightness 16                             # flow with no sensor input
./cli flow --tilt=-0.5                                # fixed simulated heel-down tilt
./cli flow --stomp-every 2s                           # timed flashes and trails
./cli flow --motion                                   # onboard tilt and stomp input
./cli flow --motion --log-motion                      # same, and stream motion over USB
./cli flow --debug                                    # stay attached and stream the output
./cli fire-trail --stomp-every 1s                     # repeat fire trails from the middle
./cli fire-trail --tilt=1                             # trails from the toe (-1 for the heel)
./cli fire-trail --motion                             # real stomps trigger fire trails
./cli color --lit 20 --brightness 16 --interval 500ms # cycle white/red/green/blue
./cli color --color '#ff8000' --lit 10                # fixed orange, other pixels black
./cli off                                             # blank all connected pixels
./cli flow --build-only                               # compile without uploading
./cli flow --dry-run                                  # show settings without building
./cli flow --help
```

- Pattern tests light the boot's saved strip layout. They ask the boot for it over USB, then
  fall back to what that board last reported, then to `include/config.h`, and they print which
  one they used. A bench build can't answer, so the last report is kept in `boards.json`, in a
  `firewalker-cli` folder under your user config folder.
- `--pixels` overrides the total connected length, and pattern tests then scale the toe and heel
  to fit. `--toe` and `--heel` override either marker, in either order. These only apply to that
  test, and never change what the boot has saved. Color and off tests use the length in
  `include/config.h`, and `--lit` chooses how many pixels light up while the rest get black.
- With several boards connected, `--port` or `--serial` picks one. A selection that
  matches nothing fails rather than falling through to another shoe. With no boards, it suggests
  a data cable or a port without a hub, because a charge-only cable powers the board without
  showing it on USB.
- `--motion` can't be combined with simulated `--tilt` or `--stomp-every`.
- `--debug` and `--log-motion` stay attached after the upload and reconnect if the board resets.
  In a terminal, lines are colored and anything you type goes to the board. Piped, you get the
  board's raw lines with no color. Ctrl-C leaves the board running.

A bench test replaces the app on that board. `./cli app`, or `a` in the TUI, gets it back with
its saved settings still there.

The same tests are available without Go, and there's a build for checking the sensor's
axes and thresholds:

```bash
pio run -e strip_test -t upload  # cycle colors on every pixel
pio run -e strip_off -t upload   # blank every pixel
pio run -e imu_debug -t upload   # log raw motion over USB, and mirror tilt as brightness
pio device monitor
```

`off` blanks the pixels but doesn't disconnect their power, so the strip still draws
its idle current. Unplug it for a full power-off.

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
- Domain language: [`CONTEXT.md`](CONTEXT.md). Decisions: [`docs/adr/`](docs/adr).
- Agent, Linear, and triage setup: [`CLAUDE.md`](CLAUDE.md) and `docs/agents/`.

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
