# Power budget

Why current is the ceiling on this rig, and what the brightness settings mean for each
supported power setup.

## The numbers

BTF's [specification for the 160-pixel FCOB strip](https://www.btf-lighting.com/products/fcob-rgb-addressable-led-strip-dc5v-160pixels)
lists up to **8 W per meter at 5 V**. With 160 pixels per meter, that's about 10 mA per
pixel at full white. These are rated figures, not measurements of this strip, and its idle
current hasn't been measured yet either. Every connected pixel controller draws idle power
even when showing black.

A boot needs about **69 cm of strip, which is about 110 pixels**. That's a measured length
with the exact cut point still open, so these numbers will shift slightly. At full white:

| Strip | Pixels | Power | Current |
|---|---|---|---|
| One boot, cut to about 69 cm | ~110 | ~5.5 W | ~1.1 A |
| Both boots, if they ever share one supply | ~220 | ~11 W | ~2.2 A |
| Uncut bench strip | 160 | ~8 W | ~1.6 A |

The firmware applies brightness to every channel, so requested current scales roughly with
`brightness / 255`, and with how many channels and pixels are lit. For one boot:

| Brightness | ~110 pixels, white | ~110 pixels, 2-channel color | ~110 pixels, 1-channel color | Uncut strip, white |
|---|---|---|---|---|
| `16` | ~69 mA | ~46 mA | ~23 mA | ~100 mA |
| `32` | ~138 mA | ~92 mA | ~46 mA | ~200 mA |
| `45` (default, 70% in the app) | ~194 mA | ~129 mA | ~65 mA | ~282 mA |
| `64` (remote cap) | ~276 mA | ~184 mA | ~92 mA | ~400 mA |
| `96` | ~414 mA | ~276 mA | ~138 mA | ~602 mA |
| `128` | ~552 mA | ~368 mA | ~184 mA | ~803 mA |
| `255` | ~1.1 A | ~733 mA | ~367 mA | ~1.6 A |

## What the patterns draw

- **flow** cycles one hue through the spectrum, so a full strip passes through
  2-channel colors (yellow, cyan, magenta). It rests at 80% per-pixel brightness when
  level, and a level stomp flashes the whole strip **white**, which is its worst case.
- **fire-trail** uses red-through-yellow, so about 1 to 2 channels per pixel, and only
  lights the bands that are moving.

## Power profiles

**USB bench, up to brightness 64.** Seeed recommends keeping the XIAO's 5V pad under
500 mA, which also has to cover the board itself and whatever the USB port can actually
supply. `LED_BRIGHTNESS_MAX` in [`config.h`](../include/config.h) caps the remote at 64,
which keeps a full-white frame on the uncut strip near 400 mA by its rating. Once the strip
is cut to about 110 pixels, the same cap only reaches about 276 mA, so it could rise to
about 96 and stay near that 400 mA target.

**External 5 V, above the cap.** Feed the strip directly from a 5 V supply, with grounds
tied together (see [`wiring.md`](wiring.md)). Rate it for at least 1.5 A per cut strip, which
leaves headroom over the ~1.1 A full-white draw, or 2 A for the uncut strip. Raising the cap
takes a build flag, so a USB-powered board can't be pushed past it by accident:

```bash
PLATFORMIO_BUILD_SRC_FLAGS=-DFIREWALKER_LED_BRIGHTNESS_MAX=255 pio run -e final_app -t upload
```

Build both shoes the same way. Settings saved under a higher cap read as invalid under a
lower one, so that shoe falls back to its defaults.

`./cli --brightness` accepts up to 255 regardless of the cap, because it's a deliberate
bench override. Keep it within the profile you're actually powering.

The final battery design is outside this budget, and is tracked in
[`open-questions.md`](open-questions.md).

## Levers to stay safe

- Lower the brightness, which scales everything.
- Shorten `FLOW_TRAIL_LEN` or `FIRE_TRAIL_LEN`, or drop `FIRE_TRAIL_MAX`.
- Estimate before raising anything: pixels lit × per-pixel current, against the real
  budget of the power source.
