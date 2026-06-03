# Firewalker Shoes

Wearable LED-shoe firmware, inspired by Adafruit's Gemma LED Sneakers /
Firewalker guide. Built with **PlatformIO + Arduino framework** in VS Code (not
the Arduino IDE).

> **Status:** button-triggered animation on the Feather RP2040 rig. The firmware drives
> **39 pixels** of one WS2812B strip: each button press launches a **fire
> trail** — a band that travels bottom→top with a hot head cooling through
> orange to a deep-red tail, wiping in at the bottom and out at the top.
> Presses stack into several trails at once. No accelerometer or wireless yet —
> the button is a temporary stand-in for a foot stomp.

## Hardware

| | |
|---|---|
| Board | Adafruit Feather RP2040 |
| LED strip | WS2812B, `NEO_GRB` + 800 KHz |
| Data pin | Feather **D5** → strip DIN (direct, no level shifter on current rig) |
| Pixels driven | 39 (current strip length) |
| Button | Feather **D6** → GND (`INPUT_PULLUP`, stomp simulator) |
| Power | Feather **USB/VBUS** → strip 5V, common ground — current scales with brightness × pixels lit (see [`docs/power-budget.md`](docs/power-budget.md)) |

See [`docs/wiring.md`](docs/wiring.md) for the current minimal wiring,
[`docs/wiring-extra-effort.html`](docs/wiring-extra-effort.html) for the
level-shifter/resistor reference, and
[`docs/open-questions.md`](docs/open-questions.md) for unresolved hardware
decisions.

## Quick start

```bash
# Build
pio run

# Upload to a connected Feather RP2040 (auto-detects the port)
pio run -t upload

# Watch serial output (115200 baud)
pio device monitor -e adafruit_feather
```

Expected serial output:

```
[firewalker] ready — press the button to stomp
[firewalker] pixels=39 led pin=7 button pin=8
[firewalker] stomp -> trail (1 active)
[firewalker] stomp -> trail (2 active)
...
```

At rest the strip is dark. Each button press launches a fire trail that travels
up the strip and slides off the top. Press again — even mid-trail — and a new
trail starts behind it, so several can climb at once.

## ⚠️ Power safety

Current scales with **brightness × pixels lit**, and trails stack — so the
worst case is the whole strip lit by overlapping trails. Before running
brighter, longer, or with more pixels, read
[`docs/power-budget.md`](docs/power-budget.md) and use a dedicated 5V strip
supply with grounds tied together.

## Project conventions

- Hardware knobs (pin, count, brightness, baud, color) live in
  [`include/config.h`](include/config.h).
- Domain language: [`CONTEXT.md`](CONTEXT.md). Decisions: [`docs/adr/`](docs/adr).
- Agent / Linear / triage setup: [`CLAUDE.md`](CLAUDE.md) and `docs/agents/`.
