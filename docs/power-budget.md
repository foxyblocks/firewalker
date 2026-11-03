# Power budget

Why current is the ceiling on this rig, and what the brightness settings mean for each
supported power setup.

## The numbers

BTF's [specification for the 160-pixel FCOB strip](https://www.btf-lighting.com/products/fcob-rgb-addressable-led-strip-dc5v-160pixels)
lists up to **8 W per meter at 5 V**, about **1.6 A** for the full strip at white. That's
about 10 mA per pixel at full white. These are rated figures, not measurements of this
strip, and the strip's idle current hasn't been measured yet either. All 160 pixel
controllers draw idle power even when showing black.

The firmware applies brightness to every channel, so requested current scales roughly
with `brightness / 255`, and with how many channels and pixels are lit:

| Brightness | Full strip, white | Full strip, 2-channel color | Full strip, 1-channel color |
|---|---|---|---|
| `16` (default) | ~100 mA | ~67 mA | ~33 mA |
| `32` | ~200 mA | ~134 mA | ~67 mA |
| `64` (remote cap) | ~400 mA | ~268 mA | ~134 mA |
| `128` | ~800 mA | ~535 mA | ~268 mA |
| `255` | ~1.6 A | ~1.07 A | ~535 mA |

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
which keeps a full-white frame near 400 mA by the strip's rating.

**External 5 V, above brightness 64.** Feed the strip directly from a supply rated at
least 2 A, with grounds tied together (see [`wiring.md`](wiring.md)). Raising the cap
takes a build flag, so a USB-powered board can't be pushed past it by accident:

```bash
PLATFORMIO_BUILD_SRC_FLAGS=-DFIREWALKER_LED_BRIGHTNESS_MAX=255 pio run -e final_app -t upload
```

Build both shoes the same way. Settings saved under a higher cap read as invalid under a
lower one, so that shoe falls back to its defaults.

`./mg24 --brightness` accepts up to 255 regardless of the cap, because it's a deliberate
bench override. Keep it within the profile you're actually powering.

The final battery design is outside this budget, and is tracked in
[`open-questions.md`](open-questions.md).

## Levers to stay safe

- Lower the brightness, which scales everything.
- Shorten `FLOW_TRAIL_LEN` or `FIRE_TRAIL_LEN`, or drop `FIRE_TRAIL_MAX`.
- Estimate before raising anything: pixels lit × per-pixel current, against the real
  budget of the power source.
