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

## Commands

| Command | Effect |
|---|---|
| `status` | Reports the current state |
| `pattern flow`, `pattern fire-trail`, `pattern off` | Selects a pattern and remembers it |
| `power on`, `power off` | Off blanks the strip. On returns to the last lit pattern |
| `brightness <n>` | Sets brightness, from 1 to `maxBrightness` |
| `calibrate` | Captures this boot's neutral pose; hold it still for one second |
| `debug on`, `debug off` | Starts or stops live motion lines |

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
`unknown-command`, `unknown-pattern`, `expected-on-or-off`, `expected-0-to-255`,
`out-of-range`, and `already-capturing`, plus the calibration reasons below. A
command the firmware can't parse reports `"cmd":"unknown"`.

### `status`

Sent in reply to `status`, when a client subscribes, and after any change. Changes
are reported at most every 250 ms, so a slider drag gets one line per interval.

```json
{"t":"status","id":"3ED1","pattern":"flow","brightness":24,"maxBrightness":64,"sensor":"ok","tilt":0.02,"calibrated":true,"neutralDeg":1.56,"calibration":"idle","saved":true,"saveFailed":false,"saves":0,"debug":false,"ble":true}
```

| Field | Meaning |
|---|---|
| `id` | Four hex digits identifying this controller |
| `pattern` | `flow`, `fire-trail`, or `off` |
| `brightness`, `maxBrightness` | The current level and the highest this build accepts |
| `sensor` | `ok` or `unavailable` |
| `tilt` | Fused fore-aft tilt from -1 (heel-down) to +1 (toe-down), relative to neutral |
| `calibrated`, `neutralDeg` | Whether a neutral has been captured, and its offset in degrees |
| `calibration` | The latest capture: `idle`, `capturing`, `ok`, or a failure reason |
| `saved` | Every current setting is in flash, so it will survive a power cycle |
| `saveFailed` | The latest flash write failed |
| `saves` | Flash writes since boot |
| `debug` | Whether motion lines are on |
| `ble` | Whether a BLE client is subscribed |

`saved` stays `false` for up to a second or so after a change while the save waits
for the changes to pause. A slider drag becomes one flash write rather than one per
update, and `saves` lets a test confirm that.

### `calibrate`

Reports a capture's progress.

```json
{"t":"calibrate","state":"capturing"}
{"t":"calibrate","state":"ok","neutralDeg":1.56,"tilt":0.00}
{"t":"calibrate","state":"failed","reason":"motion"}
```

| Reason | Meaning |
|---|---|
| `motion` | The boot moved during the capture |
| `no-samples` | The sensor stopped delivering fresh samples |
| `sensor-unavailable` | The motion sensor isn't available |
| `out-of-range` | The boot held still, but too far from level to be a neutral pose |

A failed capture leaves the previous calibration in place, both in use and in flash.

A capture sets where tilt reads zero. It doesn't change which direction counts as
toe-down, the strip's toe and heel positions, or the stomp thresholds. The firmware
never captures on its own at startup, because a boot may be tilted then.

The window, stillness bounds, and limits are the `NEUTRAL_*` values in
[`config.h`](../include/config.h). A successful capture leaves tilt within about
±0.1 for as long as the boot stays in the captured pose.

### `motion`

Sent about five times a second while debug is on.

```json
{"t":"motion","tilt":0.05,"angleDeg":1.42,"accel":10.18,"gyro":0.03,"stomp":false,"strength":0.00}
```

| Field | Meaning |
|---|---|
| `tilt` | Same as in status |
| `angleDeg` | Fused fore-aft angle before the neutral offset |
| `accel` | Total acceleration, m/s², including gravity |
| `gyro` | Total rotation rate, rad/s |
| `stomp` | A stomp fired since the previous motion line |
| `strength` | The latest stomp's force from 0 to 1 |

These are the first lines dropped if BLE falls behind, so a client should treat them
as a sampled view rather than a complete record.

## Disconnects

Disconnecting never changes anything on the shoe. The pattern, brightness, and motion
processing keep running, and the shoe starts advertising again. Settings saved before
the disconnect stay saved.
