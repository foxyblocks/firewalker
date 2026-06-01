# Firewalker Shoes

Wearable LED-shoe firmware, inspired by Adafruit's Gemma LED Sneakers /
Firewalker guide. Built with **PlatformIO + Arduino framework** in VS Code (not
the Arduino IDE).

> **Status:** button-triggered animation on the test rig. The firmware drives
> **39 pixels** of one WS2812B strip: each button press launches a **fire
> trail** — a band that travels bottom→top with a hot head cooling through
> orange to a deep-red tail, wiping in at the bottom and out at the top.
> Presses stack into several trails at once. No accelerometer or wireless yet —
> the button is a temporary stand-in for a foot stomp.

## Hardware (first test rig)

| | |
|---|---|
| Board | Arduino Uno R3 (ATmega328P) |
| LED strip | WS2812B, `NEO_GRB` + 800 KHz |
| Data pin | Uno digital **6** → strip DIN |
| Pixels driven | 39 (current strip length) |
| Button | Uno digital **10** → GND (`INPUT_PULLUP`, stomp simulator) |
| Power | USB 5V only — current scales with brightness × pixels lit (see [`docs/power-budget.md`](docs/power-budget.md)) |

See [`docs/wiring.md`](docs/wiring.md) for the wiring assumptions and
[`docs/open-questions.md`](docs/open-questions.md) for unresolved hardware
decisions.

## Quick start

```bash
# Build
pio run -e uno

# Upload to a connected Uno (auto-detects the port)
pio run -e uno -t upload

# Watch serial output (115200 baud)
pio device monitor -b 115200
```

Expected serial output:

```
[firewalker] ready — press the button to stomp
[firewalker] pixels=39 button pin=10
[firewalker] stomp -> trail (1 active)
[firewalker] stomp -> trail (2 active)
...
```

At rest the strip is dark. Each button press launches a fire trail that travels
up the strip and slides off the top. Press again — even mid-trail — and a new
trail starts behind it, so several can climb at once.

## ⚠️ Power safety

The strip is powered from the Uno's USB 5V. Current scales with **brightness ×
pixels lit**, and trails stack — so the worst case is the whole strip lit by
overlapping trails. At the current `LED_BRIGHTNESS` that full-strip moment is
near the ~450 mA USB budget, so heavy button-mashing can brown out or flicker.
Before running brighter, longer, or with more pixels, read
[`docs/power-budget.md`](docs/power-budget.md) and move the strip onto an
external 5V supply.

## Project conventions

- Hardware knobs (pin, count, brightness, baud, color) live in
  [`include/config.h`](include/config.h).
- Domain language: [`CONTEXT.md`](CONTEXT.md). Decisions: [`docs/adr/`](docs/adr).
- Agent / Linear / triage setup: [`CLAUDE.md`](CLAUDE.md) and `docs/agents/`.
