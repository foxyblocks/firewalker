# Firewalker Shoes

Wearable LED-shoe firmware, inspired by Adafruit's Gemma LED Sneakers / Firewalker
guide. Built with **PlatformIO + Arduino framework**.

Each shoe is a Seeed Studio XIAO MG24 Sense driving one addressable LED strip. The
board's onboard motion sensor drives two patterns:

- **flow**: the strip shares one hue that slowly rotates through the spectrum and
  "pools" toward whichever end of the foot tilts down. A stomp launches trails from
  the down-point, or flashes the strip white if the foot is level.
- **fire-trail**: each stomp launches a fire-gradient band that climbs the strip,
  and several can stack at once.

Both shoes run the same firmware. Each one remembers its own pattern, brightness, and
neutral calibration across power cycles, and can be controlled without reflashing
from an iPhone app over BLE or from a computer over USB.

## Hardware

| | |
|---|---|
| Board | Seeed Studio XIAO MG24 Sense |
| Motion sensor | Onboard LSM6DS3TR-C, no wiring needed |
| LED strip | BTF-LIGHTING FCOB-5V-160L-W-IP30-SPI-5MM: about 1 m, 160 RGB pixels, 5 V, XGB1338 (WS2812B-compatible) |
| Data pin | **D10** to the strip's DIN, at the input end |
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
pattern fire-trail
pattern off
brightness 32
calibrate
debug on
```

Replies are JSON lines. [`docs/remote-protocol.md`](docs/remote-protocol.md) has the
full reference, including the BLE service an iPhone app connects to. The app itself is
tracked in [FOX-269](https://linear.app/foxyblocks/issue/FOX-269).

To calibrate neutral, hold the boot still in its resting position and send `calibrate`.
The firmware samples for one second and treats that pose as level from then on. If the
boot moves, it reports why and keeps the previous calibration. Do this once per boot.

## Bench tests

`./cli` builds a one-off strip test and flashes it, without changing any firmware
settings or a shoe's saved settings. It needs [Go](https://go.dev) and PlatformIO.

```bash
./cli flow --pixels 160 --brightness 16               # flow with no sensor input
./cli flow --tilt=-0.5                                # fixed simulated heel-down tilt
./cli flow --stomp-every 2s                           # timed flashes and trails
./cli flow --motion                                   # onboard tilt and stomp input
./cli flow --motion --log-motion                      # same, and stream motion over USB
./cli fire-trail --stomp-every 1s                     # repeat fire trails without motion
./cli fire-trail --motion                             # real stomps trigger fire trails
./cli color --lit 20 --brightness 16 --interval 500ms # cycle white/red/green/blue
./cli color --color '#ff8000' --lit 10                # fixed orange, other pixels black
./cli off                                             # blank all connected pixels
./cli flow --build-only                               # compile without uploading
./cli flow --dry-run                                  # show settings without building
./cli flow --help
```

- `--pixels` is the total connected length, and color tests use `--lit` to choose how
  many light up while the rest get black.
- Pattern tests derive virtual toe and heel positions from the strip length, and
  `--toe` and `--heel` override them.
- With several boards connected, `--port` or `--serial` picks one. A selection that
  matches nothing fails rather than falling through to another shoe.
- `--motion` can't be combined with simulated `--tilt` or `--stomp-every`.

A bench test replaces the app on that board. Flash the app again to get it back; its
saved settings are still there.

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

Brightness scales requested color. It isn't a current limit, and the strip can pull
about 1.6 A at full white. The firmware caps the remote at brightness 64 so a USB-fed
strip stays near the 500 mA the board's 5V pad should supply. Before raising the cap or
running brighter, read [`docs/power-budget.md`](docs/power-budget.md) and use a
dedicated 5 V supply with grounds tied together.

## Known limits

- Toe and heel positions are the bench layout (toe 52, heel 132), not measurements of
  a mounted shoe. See [`docs/open-questions.md`](docs/open-questions.md).
- Battery and enclosure design are still open.
- BLE has no pairing, so anyone nearby with a BLE app can connect and change a shoe's
  settings.

## Project conventions

- Hardware knobs live in [`include/config.h`](include/config.h).
- Domain language: [`CONTEXT.md`](CONTEXT.md). Decisions: [`docs/adr/`](docs/adr).
- Agent, Linear, and triage setup: [`CLAUDE.md`](CLAUDE.md) and `docs/agents/`.
