# Firewalker Shoes

Wearable LED-shoe firmware, inspired by Adafruit's Gemma LED Sneakers /
Firewalker guide. Built with **PlatformIO + Arduino framework** in VS Code (not
the Arduino IDE).

> **Status:** button-triggered animation on the test rig. The firmware drives
> **39 pixels** of one WS2812B strip: a button press runs a color-wipe
> animation (grows bottom→top, holds, clears) at a USB-safe brightness, with
> status over serial. No accelerometer or wireless yet — the button is a
> temporary stand-in for a foot stomp.

## Hardware (first test rig)

| | |
|---|---|
| Board | Arduino Uno R3 (ATmega328P) |
| LED strip | WS2812B, `NEO_GRB` + 800 KHz |
| Data pin | Uno digital **6** → strip DIN |
| Pixels driven | 39 (current strip length) |
| Button | Uno digital **10** → GND (`INPUT_PULLUP`, stomp simulator) |
| Power | USB 5V only — brightness capped (see [`docs/power-budget.md`](docs/power-budget.md)) |

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
[firewalker] stomp -> wipe start
[firewalker] wipe done — cleared
...
```

At rest the strip is dark. Each button press wipes a warm amber fill on
bottom→top (~1 s), holds briefly, then clears. Pressing again restarts it.

## ⚠️ Power safety

The strip is powered from the Uno's USB 5V, which is why brightness is capped at
`32/255` **and the fill is not white** — the wipe ends with all 39 pixels lit at
once, and white at that point (~330 mA) is the worst case for the USB supply.
Before raising brightness or driving more pixels, read
[`docs/power-budget.md`](docs/power-budget.md) and move the strip onto an
external 5V supply.

## Project conventions

- Hardware knobs (pin, count, brightness, baud, color) live in
  [`include/config.h`](include/config.h).
- Domain language: [`CONTEXT.md`](CONTEXT.md). Decisions: [`docs/adr/`](docs/adr).
- Agent / Linear / triage setup: [`CLAUDE.md`](CLAUDE.md) and `docs/agents/`.
