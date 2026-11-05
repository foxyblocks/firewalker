# Remote protocol

How a client controls a shoe's running firmware without reflashing. BLE and the
USB serial console speak the same protocol. The firmware side is
[`firewalker_remote.h`](../include/firewalker_remote.h) (the channels) and
[`firewalker_remote_protocol.h`](../include/firewalker_remote_protocol.h) (parsing
and formatting).

A client sends **one text command per line** and receives **one JSON object per
line**. Everything the firmware reports is its actual state, so a client that
reconnects can trust the status line rather than remembering what it last sent.

## Connecting

### BLE

Each controller advertises as `Firewalker-XXXX`, where `XXXX` is the same `id`
reported in status. Use it to tell the two shoes apart. Each controller holds one
connection at a time, and no pairing is required.

The service uses the Nordic UART Service UUIDs, so generic BLE terminals can talk
to it too:

| | UUID | Use |
|---|---|---|
| Service | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` | Advertised, so apps can filter on it |
| RX | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` | Write one command per write, with or without response |
| TX | `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` | Subscribe for replies |

- Subscribing to TX sends a status line, so a reconnecting client sees the current
  state straight away.
- A reply can span several notifications. Join them until the newline.
- Every valid command fits in the default 20-byte write, with or without a trailing
  newline.

### USB

Open the board's USB serial port at 115200 baud, for example with
`pio device monitor`, and type commands. Each line ends with a newline. Replies come
back on the same port, alongside the firmware's `[firewalker]` log lines, which
aren't JSON.

- Opening the port doesn't reset the boot, and the boot sends nothing until it's asked,
  so send `status` first. There's no subscribe, as there is over BLE.
- The USB id is `2886:0062`, shared by every MG24, and the port has no other name a browser
  can read. A client that has to tell boots apart reads `id` from a status line.
- Replies go to USB and BLE alike, so a client on one sees the acks for commands sent on
  the other.

## Commands

| Command | Effect |
|---|---|
| `status` | Reports the current state |
| `patterns` | Lists the patterns this boot can show |
| `pattern flow`, `pattern fire-trail`, `pattern off` | Selects a pattern and remembers it |
| `power on`, `power off` | Off blanks the strip. On returns to the last lit pattern |
| `brightness <n>` | Sets brightness, from 1 to `maxBrightness` |
| `calibrate neutral`, `calibrate heel`, `calibrate toe` | Captures one pose; hold it for two seconds. A bare `calibrate` means neutral |
| `debug on`, `debug off` | Starts or stops live motion lines |
| `identify` | Blinks the strip for about 1.5 seconds, to show which boot this is. Changes no settings |
| `strip leds <n>`, `strip toe <n>`, `strip heel <n>` | Sets the pixel count, or the pixel at the toe or heel, and remembers it. See [Strip layout](#strip-layout) |
| `strip preview on`, `strip preview off` | Shows the layout on the strip in place of the pattern, or returns to the pattern. Changes no settings |

Each controller keeps its own settings, and a command only affects the controller
that receives it. `off` blanks the pixels but doesn't disconnect their power, so the
strip still draws its idle current.

## Replies

### `ack`

Sent once per command, except `status`, which replies with a status line directly.

```json
{"t":"ack","cmd":"brightness","ok":true}
{"t":"ack","cmd":"brightness","ok":false,"error":"out-of-range"}
```

Errors are `empty`, `too-long`, `too-many-arguments`, `expected-one-argument`,
`unknown-command`, `unknown-pattern`, `unknown-pose`, `expected-on-or-off`,
`expected-0-to-255`, `expected-setting-and-value`, `expected-number`, `unknown-strip-setting`,
`out-of-range`, `same-pixel`, and `already-capturing`, plus `sensor-unavailable` for a capture
that can't start. A command the firmware can't parse
reports `"cmd":"unknown"`.

### `patterns`

Sent in reply to `patterns`. Off isn't listed, because it's the absence of a pattern, not
a pattern to choose. Names are at most 12 characters, so `pattern <name>` always fits in a
default 20-byte write.

```json
{"t":"patterns","list":["flow","fire-trail"]}
```

### `status`

Sent in reply to `status`, when a client subscribes, and after any change. Changes
are reported at most every 250 ms, so a slider drag gets one line per interval.

```json
{"t":"status","proto":2,"id":"3ED1","pattern":"off","lit":"flow","brightness":24,"maxBrightness":64,"sensor":"ok","tilt":0.00,"calibrated":true,"neutralDeg":1.56,"heelDeg":-18.40,"toeDeg":null,"calibration":"idle","saved":true,"saveFailed":false,"saves":0,"debug":false,"ble":true,"leds":110,"maxLeds":160,"toe":40,"heel":90,"preview":false}
```

| Field | Meaning |
|---|---|
| `proto` | The protocol version, so an app can tell when a boot's firmware needs updating |
| `id` | Four hex digits identifying this controller |
| `pattern` | The current pattern, or `off` |
| `lit` | The pattern `power on` returns to, even while the strip is off |
| `brightness`, `maxBrightness` | The current level and the highest this build accepts |
| `sensor` | `ok` or `unavailable` |
| `tilt` | Fused fore-aft tilt: -1 at the heel pose, 0 at neutral, +1 at the toe pose |
| `calibrated`, `neutralDeg` | Whether a neutral has been captured, and its angle in degrees |
| `heelDeg`, `toeDeg` | Those poses' angles in degrees, or `null` until captured |
| `calibration` | The latest capture: `idle`, `capturing`, `ok`, or a failure reason |
| `saved` | Every current setting is in flash, so it will survive a power cycle |
| `saveFailed` | The latest flash write failed |
| `saves` | Flash writes since boot |
| `debug` | Whether motion lines are on |
| `ble` | Whether a BLE client is subscribed |
| `leds`, `maxLeds` | How many pixels the ring has, and the most this build can drive |
| `toe`, `heel` | The pixels at the toe and heel, counting from 0 |
| `preview` | Whether the strip is showing its layout in place of its pattern |

`saved` stays `false` for up to a second or so after a change while the save waits
for the changes to pause. A slider drag becomes one flash write rather than one per
update, and `saves` lets a test confirm that.

### `calibrate`

Reports a capture's progress. `angleDeg` is the angle the firmware saved for that pose.

```json
{"t":"calibrate","pose":"heel","state":"capturing"}
{"t":"calibrate","pose":"heel","state":"ok","angleDeg":-18.40,"tilt":-1.00}
{"t":"calibrate","pose":"heel","state":"failed","reason":"motion"}
```

| Reason | Meaning |
|---|---|
| `motion` | The boot never settled into one pose during the capture |
| `no-samples` | The sensor stopped delivering fresh samples |
| `sensor-unavailable` | The motion sensor isn't available |
| `out-of-range` | A neutral pose too far from level, more than 45 degrees |
| `too-close` | A heel or toe pose less than 10 degrees from neutral |
| `wrong-side` | Heel and toe on the same side of neutral |

A failed capture leaves the previous calibration in place, both in use and in flash.

#### How the poses work

Take them while wearing the boot, so they capture what that foot really does. Capture
neutral first, because heel and toe are checked against it. Each controller stores its own,
and the firmware never captures on its own at startup, because a boot may be tilted then.

- Tilt maps heel to -1, neutral to 0, and toe to +1, so patterns don't need to know about
  calibration. Each side scales on its own range.
- Heel and toe are optional. A side with no captured pose reaches full tilt 30 degrees from
  neutral, so a neutral-only boot works.
- Direction comes from the poses, so a controller mounted backward corrects itself once
  heel or toe is captured.
- Retaking neutral keeps heel and toe, unless the new neutral lands past one of them or
  within 10 degrees of it. That side then returns to its default.
- Tilt reads exactly 0 within 3 degrees of neutral, so a calibrated boot rests flat.

A capture sets where tilt lands. It doesn't change the strip's toe and heel pixels (see
[Strip layout](#strip-layout)) or the stomp thresholds, because steps and stomps are quick
spikes rather than held angles. Watch `accelPeak` in motion lines to tune those.

A capture collects the whole two seconds and judges it at the end, using only the middle
half of the samples. Tremor, a slow sag, a brief stumble, or settling in late all still work.
It only fails with `motion` if that middle half is spread too wide, such as a foot rocking
from heel to toe. The window and limits are in [`config.h`](../include/config.h)
(`CALIBRATION_*` and `TILT_LIMITS`).

### Strip layout

Each controller saves how many pixels its ring has and which of them sit at the toe and heel,
so a strip cut to fit a boot needs no firmware change. Pixels count from 0, the first one after
the controller, so on a 110-pixel ring the last pixel is 109. A first boot starts from the values
in [`config.h`](../include/config.h), and a boot updated from earlier firmware keeps its other
settings and starts from those too.

The rules, in [`firewalker_strip_map.h`](../include/firewalker_strip_map.h):

- `strip leds` takes 2 up to `maxLeds`. Pixels past the count stay dark.
- `strip toe` and `strip heel` take any pixel in the ring except the other one's, which fails
  with `same-pixel`. Toe and heel can fall in either order, because the ring can run either way
  around the foot.
- A shorter count never fails over the toe or heel. One past the new end moves to the end, keeping
  its side of the other. For example, toe 52 and heel 132 with `strip leds 110` become toe 52 and
  heel 109. The status line reports where they landed.

Changes save the same way a brightness change does, so a slider drag becomes one flash write.

`strip preview on` is how you see what you're setting. The whole ring lights blue, so you stop
the count when the blue reaches the end of the strip, with one yellow pixel at the toe and one
purple pixel at the heel. Pixels past the count stay dark.

It runs at a fixed brightness, whatever the boot's brightness and pattern are, and it even shows
with the lights off. It lasts one minute from the latest `strip` command, so a client holds it up
by repeating `strip preview on` and can't leave a boot stuck on it by going away. When it ends,
the pattern starts again.

### `motion`

Sent about five times a second while debug is on.

```json
{"t":"motion","tilt":0.05,"angleDeg":1.42,"accel":10.18,"accelPeak":10.31,"gyro":0.03,"stomp":false,"strength":0.00}
```

| Field | Meaning |
|---|---|
| `tilt` | Same as in status |
| `angleDeg` | Fused fore-aft angle before calibration |
| `accel` | Total acceleration at this moment, m/s², including gravity |
| `accelPeak` | The highest total acceleration since the previous motion line, which catches a step's spike |
| `gyro` | Total rotation rate, rad/s |
| `stomp` | A stomp fired since the previous motion line |
| `strength` | The latest stomp's force from 0 to 1 |

These are the first lines dropped if BLE falls behind, so a client should treat them
as a sampled view rather than a complete record.

## Disconnects

Disconnecting never changes anything on the shoe. The pattern, brightness, and motion
processing keep running, and the shoe starts advertising again. Settings saved before
the disconnect stay saved. A strip preview runs out its minute and then ends.
