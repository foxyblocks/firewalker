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
- Every valid command except the `recipe` ones fits in the default 20-byte write, with or without a trailing
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
| `pattern <name>`, `pattern off` | Selects and remembers a pattern, restarting it on every selection. `patterns` lists the names. `pattern off` blanks the strip |
| `power on`, `power off` | Off blanks the strip. On returns to the last lit pattern |
| `brightness <n>` | Sets brightness, from 1 to `maxBrightness`, which the soft cap lowers while it's on |
| `cap on`, `cap off` | Turns the soft brightness cap on or off and remembers it. On brings a brightness over the cap down to it. See [Soft brightness cap](#soft-brightness-cap) |
| `calibrate neutral`, `calibrate heel`, `calibrate toe` | Captures one pose; hold it for two seconds. A bare `calibrate` means neutral |
| `calibrate clear heel`, `calibrate clear toe` | Removes that saved side pose, keeping neutral and the other side; requires protocol 5 |
| `calibrate clear all` | Resets neutral, heel, and toe to uncalibrated defaults; requires protocol 5 |
| `debug on`, `debug off` | Starts or stops live motion and audio lines |
| `identify` | Blinks the strip and MG24 Sense onboard user LED together for about 1.5 seconds, starting dark. Restores the pattern and status light afterward. Changes no settings |
| `strip leds <n>`, `strip toe <n>`, `strip heel <n>` | Sets the pixel count, or the pixel at the toe or heel, and remembers it. See [Strip layout](#strip-layout) |
| `strip preview on`, `strip preview off` | Shows the layout on the strip in place of the pattern, or returns to the pattern. Changes no settings |
| `recipes` | Lists uploaded recipes, free slots, and the recipe versions this firmware can read. See [Recipes](#recipes) |
| `recipe info <name>` | Reports one uploaded recipe's size and checksum |
| `recipe begin <name> <bytes>` | Starts an upload |
| `recipe data <offset> <hex>` | Sends up to 15 bytes of an upload, as up to 30 hex characters |
| `recipe end` | Checks the whole recipe and saves it |
| `recipe cancel` | Abandons the upload |
| `recipe delete <name>` | Deletes an uploaded recipe |

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
that can't start, and `bad-recipe` for a pattern whose recipe won't load. [Recipes](#recipes) has
its own. A command the firmware can't parse reports `"cmd":"unknown"`.

### `patterns`

Sent in reply to `patterns`. Off isn't listed, because it's the absence of a pattern, not
a pattern to choose. The list changes as recipes come and go, and a new one goes out after each
change. Names are at most 12 characters, so `pattern <name>` always fits in a
default 20-byte write.

```json
{"t":"patterns","list":["comet","fire-stomp","rainbow-pool"]}
```

### `status`

Sent in reply to `status`, when a client subscribes, and after any change. Changes
are reported at most every 250 ms, so a slider drag gets one line per interval.

```json
{"t":"status","proto":6,"id":"3ED1","pattern":"off","lit":"rainbow-pool","brightness":24,"maxBrightness":96,"capped":true,"capBrightness":96,"sensor":"ok","tilt":0.00,"calibrated":true,"orientationCalibrated":true,"neutralDeg":0.00,"heelDeg":-18.40,"toeDeg":null,"calibration":"idle","saved":true,"saveFailed":false,"saves":0,"debug":false,"ble":true,"leds":110,"maxLeds":160,"toe":40,"heel":90,"preview":false}
```

| Field | Meaning |
|---|---|
| `proto` | The protocol version, so an app can tell when a boot's firmware needs updating |
| `id` | Four hex digits identifying this controller |
| `pattern` | The current pattern, or `off` |
| `lit` | The pattern `power on` returns to, even while the strip is off |
| `brightness`, `maxBrightness` | The current level, and the highest `brightness` accepts right now: `capBrightness` with the cap on, 255 with it off |
| `capped`, `capBrightness` | Whether the soft cap is on, and its level. Firmware from before the cap leaves both out |
| `sensor` | `ok` or `unavailable` |
| `tilt` | Fused fore-aft tilt: -1 at the heel pose, 0 at neutral, +1 at the toe pose |
| `calibrated`, `neutralDeg` | Whether neutral has been captured; its boot-relative angle is zero in protocol 6 |
| `orientationCalibrated` | Protocol 6: neutral plus at least one side has taught the 3D mounting reference |
| `heelDeg`, `toeDeg` | Those poses' angles in degrees, or `null` until captured |
| `calibration` | The latest capture: `idle`, `capturing`, `ok`, or a failure reason |
| `saved` | Every current setting is in flash, so it will survive a power cycle |
| `saveFailed` | The latest flash write failed |
| `saves` | Flash writes since boot |
| `debug` | Whether motion and audio lines are on |
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
| `out-of-range` | An invalid sensor angle (non-finite or outside its -180..+180 degree representation) |
| `too-close` | A heel or toe pose less than 10 degrees from neutral |
| `wrong-side` | Heel and toe on the same side of neutral |
| `neutral-required` | A side pose needs a saved neutral reference first |
| `off-axis` | The side poses disagree on the fore-aft plane, or a pose is too close to opposite gravity to determine its direction |

A failed capture leaves the previous calibration in place, both in use and in flash.

#### How the poses work

If a saved pose blocks its replacement with `wrong-side`, clear that side first or
use `calibrate clear all` to start over. If the other side is still saved, clearing a side
uses its default range until it is captured again. Clearing the last side leaves tilt at
zero until a new side teaches its direction. Clearing all also removes neutral; there is no neutral-only
clear because the side poses depend on that reference. Both operations apply and
save immediately, leave strip and audio settings untouched, and refuse with
`already-capturing` while a capture is running. They return a `calibrate` ack and
an updated status; `saveFailed` still reports a flash-write failure. Protocol 5 adds
these commands so the app can offer them only on firmware that supports them.

Take them while wearing the boot, so they capture what that foot really does. Capture
neutral first, because heel and toe are checked against it. Each controller stores its own,
and the firmware never captures on its own at startup, because a boot may be tilted then.

- Tilt maps heel to -1, neutral to 0, and toe to +1, so patterns don't need to know about
  calibration. Each side scales on its own range.
- Neutral captures the resting 3D gravity direction at any controller mounting angle.
  A heel or toe pose teaches which combination of chip axes is along the foot. All three
  gyro axes track motion; no sensor axis is assumed to match the boot.
- Capture neutral and at least one side. Until that direction is known, tilt stays at zero.
  The uncaptured side uses a 30-degree default range.
- Capturing neutral again resets both side poses, because they belonged to the previous
  mounting reference. Heel/toe need at least 10 degrees of separation from neutral and
  must agree on a fore-aft plane within the configured tolerance.
- Tilt reads exactly 0 within 3 degrees of neutral. Heel/toe angles in status are signed,
  boot-relative degrees; the boot saves gravity vectors rather than those display values.
- Protocol 6/settings version 6 require fresh pose capture after updating older firmware.
  Pattern, brightness, strip layout, and microphone settings are preserved.

A capture sets where tilt lands. It doesn't change the strip's toe and heel pixels (see
[Strip layout](#strip-layout)) or the stomp thresholds, because steps and stomps are quick
spikes rather than held angles. Watch `accelPeak` in motion lines to tune those.

A capture collects two seconds of fused gravity vectors. It discards the furthest quarter
from their center, then requires the retained vectors to fit within the angular spread
limit. This tolerates a brief stumble while rejecting continuous rocking. The window,
spread, side separation, and axis agreement are configured in `config.h`.

`neutral-required` means capture neutral before a side. `off-axis` means the side poses
don't describe the same fore-aft movement; retake the side while keeping sideways lean small.

### Soft brightness cap

Each boot holds its brightness at or under its soft cap, `capBrightness` (96), unless the cap is
turned off. At 96, a full-white frame on a 107-pixel strip draws about 400 mA by the strip's rating,
which fits a USB 2.0 port's 500 mA. With the cap off, `brightness` goes up to 255: about 1.07 A at
full white on 107 pixels, more than a USB 2.0 port gives and possibly more than the 1 A diode
Seeed's schematic puts in front of the 5V pad. So turn it off only on a dedicated 5 V supply
([`power-budget.md`](power-budget.md)).

- A new boot starts with the cap on and its brightness at the cap.
- Each boot saves whether its cap is on, so a power cycle doesn't change it. A boot updated from
  firmware before the cap starts with it on and keeps its other settings.
- `cap on` brings a brightness over the cap down to it, and saves. `cap off` leaves the level alone.
- `maxBrightness` always means what `brightness` accepts right now, so an app written before the
  cap stays inside it. An app finds out whether a boot has the cap from `capped` in its status line,
  so the cap needed no new protocol version.

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

### Recipes

Every pattern is a recipe: built into the firmware or uploaded to that boot. `patterns` lists them
all, and `pattern <name>` selects one. `recipes` and the `recipe` commands deal only with uploads. A recipe sent here is in the compiled
form from [`recipe-format.md`](recipe-format.md), not its JSON.

An upload goes one line at a time, and a client waits for each `ack`:

```text
> recipe begin comet 74
< {"t":"ack","cmd":"recipe","ok":true,"next":0}
> recipe data 0 0105636f6d6574030000027a00ffff
< {"t":"ack","cmd":"recipe","ok":true,"next":15}
  ...
> recipe end
< {"t":"ack","cmd":"recipe","ok":true}
< {"t":"patterns","list":["comet","fire-stomp","rainbow-pool"]}
```

- Over BLE, lines can run to 47 characters, past a default 20-byte write, so send them as writes with
  response.
- Over USB, keep each line to 31 characters, which means 7 bytes of data per line. USB arrives a byte at a
  time into a 32-byte buffer that the firmware only empties between jobs, so a longer line can lose
  characters while it's busy, such as while it's sending a frame. On a real boot, 2 to 7% of 46-character
  lines arrived damaged, and about 0.3% of 30-character ones still do.
- So be ready to send a line again. A damaged line gets `bad-hex`, `wrong-offset`, or `"cmd":"unknown"`, and
  one that lost its newline gets no reply at all. The offset stops a repeat being stored twice, and if `begin`
  arrived wrong, `too-big` or `short` means start over. The recipe's checksum catches anything else, so a
  damaged recipe is never saved.
- `next` says which offset to send next. A lost or repeated line gets `wrong-offset` with the right `next`.
- Nothing reaches flash until `recipe end`, which checks the size, the recipe's own CRC-32, its contents,
  and that its name matches `begin`. Saving is one write, so a power cut leaves the old recipe or the new
  one. 5 seconds of silence abandons an upload.
- The pattern keeps running throughout. Upload doesn't select a recipe, but one that's on the strip restarts
  as the new version. Sending `pattern <name>` afterward selects it.
- A boot has 16 slots, and uploads survive a firmware update.

An upload can use a built-in's name, which replaces it on that boot until the upload is deleted.
Only `off` is reserved. Deleting the recipe on the strip brings back its built-in if there is
one, and otherwise the boot switches to `rainbow-pool`. A saved pattern that no longer exists does the same at
startup, keeping the boot's brightness, poses, and strip layout. Old saved `flow` and `fire-trail`
selections resume as `rainbow-pool` and `fire-stomp`, including the remembered pattern while off.
The list is alphabetical, with uploaded and built-in names appearing once each.

```json
{"t":"recipes","versions":[1,2],"slots":16,"free":15,"list":["comet"]}
{"t":"recipe","name":"comet","bytes":74,"crc":"cb75d224"}
```

`versions` lists the recipe versions this firmware can read. A recipe in another version is refused, and one
already stored stays in `recipes` so it can be deleted or replaced, but it can't be selected. `recipe info`
lets a client see that a boot already has these exact bytes, and skip sending them.

| Error | Meaning |
|---|---|
| `bad-name`, `name-reserved` | The name isn't spelled legally, or it's one a boot keeps for itself |
| `name-mismatch` | The name inside the recipe isn't the one given to `begin` |
| `too-big`, `short` | More or fewer bytes than the size given, or a size no recipe can have |
| `no-room` | Every slot is in use |
| `no-upload` | No upload is in progress, perhaps because it timed out |
| `wrong-offset` | This isn't the offset that comes next. `next` says which is |
| `bad-hex` | The data isn't an even number of hex characters, up to 30 |
| `bad-checksum`, `bad-recipe` | The recipe was damaged, or its contents don't make sense |
| `unsupported-version` | This firmware can't read that recipe version |
| `save-failed` | The flash write failed |
| `not-found`, `built-in` | No upload has that name, and if it's `built-in`, it's a recipe built into the firmware that can't be deleted |

### `motion`

Sent about five times a second while debug is on.

```json
{"t":"motion","tilt":0.05,"angleDeg":1.42,"accel":10.18,"accelPeak":10.31,"gyro":0.03,"stomp":false,"strength":0.00,"frameUs":7321}
```

| Field | Meaning |
|---|---|
| `tilt` | Same as in status |
| `angleDeg` | Fused boot-relative angle in the learned fore-aft plane; zero until neutral and a side are captured |
| `accel` | Total acceleration at this moment, m/s², including gravity |
| `accelPeak` | The highest total acceleration since the previous motion line, which catches a step's spike |
| `gyro` | Total rotation rate, rad/s |
| `stomp` | A stomp fired since the previous motion line |
| `strength` | The latest stomp's force from 0 to 1 |
| `frameUs` | The slowest pattern update since the previous motion line, in microseconds, including sending the frame |

These are the first lines dropped if BLE falls behind, so a client should treat them
as a sampled view rather than a complete record.

## Disconnects

Disconnecting never changes anything on the shoe. The pattern, brightness, and motion
processing keep running, and the shoe starts advertising again. Settings saved before
the disconnect stay saved. A strip preview runs out its minute and then ends.

### `audio`

While `debug on` is active, the firmware also sends one audio sample alongside each motion
report. These lines are best-effort telemetry, so clients may skip them while a reply is pending.

```json
{"t":"audio","ready":true,"level":0.52,"rms":5.25,"mean":703.11,"low":691,"high":716,"blocks":42,"captureUs":15687}
```

- `ready` reports whether ADC/DMA capture is running.
- `level` is the smoothed 0..1 value used by recipe bindings.
- `rms` is the changing part of the sound, in ADC counts, after removing its DC bias.
- `mean`, `low`, and `high` show raw 12-bit ADC readings for checking signal and clipping.
- `blocks` counts processed sample blocks; a growing count confirms fresh capture.
- `captureUs` measures the most recent block's sampling time, excluding processing between blocks.

### Microphone tuning

The boot remote exposes these controls under **Remote → Audio**, one boot at a time.
Protocol 4 adds per-boot settings shared by every audio-reactive recipe. USB and BLE use the
same commands. Sensitivity and quiet calibration are saved with the boot's other settings,
using the same delayed save that combines slider changes into one flash write.

| Command | Result |
|---|---|
| `audio` | Reports microphone settings and capture availability |
| `audio gain 65` | Sets sensitivity from 0 to 100; higher values respond to quieter sound |
| `audio calibrate` | Measures about 1.2 seconds of quiet background and sets the noise floor |

Pause music and keep the boot still before quiet calibration. It takes the 90th percentile
of the captured RMS values, adds headroom, and stores the result. The noise gate requires two
consecutive louder blocks to open and closes below the quiet threshold. Attack/release
smoothing then drives the bar. Raising sensitivity lowers the opening threshold and the
sound level needed to fill it.

```json
{"t":"audio-config","ready":true,"noiseFloor":9,"sensitivity":65,"calibrating":false,"saved":true}
```

`audio calibrate` and `audio gain` acknowledge as `audio`. A calibration already in progress
can be adopted by a retry, while a gain change during calibration is refused. Config replies
also arrive when calibration finishes; `saved` becomes true after the quiet save delay.
Settings version 5 reads version 4 records with default audio tuning and preserves their
pattern, brightness, poses, and layout.

### Audio waveform telemetry (protocol 6)

Debug `audio` lines also include `waveform`: 24 measured, signed samples in -1..1 from
the latest microphone block. Each sample retains the largest excursion in its time bucket.
The waveform is scaled to the configured full-volume amplitude; `rms` is the raw measured
level and `level * 100` is its normalized percent of maximum. These are live readings, not
calibrated sound-pressure decibels. Telemetry is dropped before command replies when BLE is busy.
