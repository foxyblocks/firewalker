# Firewalker

Wearable NeoPixel LED-shoe firmware. **PlatformIO + Arduino framework** (see
`docs/adr/0001-use-platformio-arduino-framework.md`). Current board: Adafruit
Feather RP2040.

**Current phase: button-triggered animation.** Drive 39 pixels of one WS2812B
strip; a button on Feather D6 (stomp simulator) drives a non-blocking, stacking
fire-trail animation, with status over serial. Out of scope: real accelerometer
step-detect, multiple strips, wireless. Don't over-engineer ahead of working
hardware.

## Project map

- `include/config.h` — all hardware knobs (pin, count, brightness, baud, color).
  Never hard-code these in `src/main.cpp`.
- `CONTEXT.md` — domain glossary; reuse these terms.
- `docs/wiring.md`, `docs/wiring-extra-effort.html`, `docs/power-budget.md` —
  current minimal wiring, protective reference wiring, and current math.
- `docs/open-questions.md` — unresolved hardware facts (don't bury uncertainty
  in code comments; record it here).
- `docs/adr/` — durable decisions.

## Build / upload / monitor

```bash
pio run                     # build default Feather env
pio run -t upload           # flash a connected Feather RP2040
pio device monitor -e adafruit_feather
```

## Working conventions

- Small, verifiable steps; build after meaningful changes.
- Hardware smoke tests are verified via serial / eyeball, not unit tests. Use
  TDD (`/tdd`) for pure logic (e.g. future animation math), not bring-up.
- Use `/diagnose` for build / upload / serial / LED-behavior failures.

## Agent skills

### Issue tracker

Issues & PRDs live in Linear — workspace `foxyblocks`, team `FOX`, project *Firewalker shoes*; driven via the `linear-cli` skill (always pass `--workspace foxyblocks`). See `docs/agents/issue-tracker.md`.

### Triage labels

The five triage roles map to Linear: `Triage` state, `Needs input` label, `ready-for-agent`/`ready-for-human` labels, `Canceled` state. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root (created lazily). See `docs/agents/domain.md`.
