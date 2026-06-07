# Firewalker

Wearable NeoPixel LED-shoe firmware. **PlatformIO + Arduino framework** (see
`docs/adr/0001-use-platformio-arduino-framework.md`). Current board: Adafruit
Feather RP2040.

**Current phase: FSR-triggered animation.** Drive 39 pixels of one WS2812B
strip; an FSR voltage divider on Feather A0 drives a non-blocking, stacking
fire-trail animation in `final_app`, with a D6 debug button kept for bench
testing. `fsr_debug` maps live FSR pressure to idle yellow brightness and keeps
the D6 button available for trail testing. Out of scope: real accelerometer
step-detect, multiple strips, wireless. Don't over-engineer ahead of working
hardware.

## Project map

- `include/config.h` — all hardware knobs (pin, count, brightness, baud, color).
  Never hard-code these in mode files.
- `src/main.cpp` — tiny Arduino dispatcher into the selected mode.
- `src/modes/` — runtime modes (`final_app`, `fsr_debug`).
- `src/firewalker_core.cpp` — shared strip, FSR, debug-button, and trail logic.
- `CONTEXT.md` — domain glossary; reuse these terms.
- `docs/wiring.md`, `docs/wiring-extra-effort.html`, `docs/power-budget.md` —
  current minimal wiring, protective reference wiring, and current math.
- `docs/open-questions.md` — unresolved hardware facts (don't bury uncertainty
  in code comments; record it here).
- `docs/adr/` — durable decisions.

## Build / upload / monitor

```bash
pio run                              # build default final_app mode
pio run -e final_app -t upload       # flash finalized behavior
pio run -e fsr_debug -t upload       # flash FSR sensor debug behavior
pio device monitor -e fsr_debug      # watch debug logs at 115200 baud
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
