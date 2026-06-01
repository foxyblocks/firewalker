# ADR-0001: Use PlatformIO with the Arduino framework

- **Status:** Accepted
- **Date:** 2026-05-31

## Context

This is a wearable NeoPixel shoe project. We want a modern, reproducible,
VS Code-based workflow with real dependency management and CLI builds — not a
one-off Arduino IDE sketch. The first test board is an Arduino Uno R3
(ATmega328P / AVR), but the production controller is not yet chosen and may be a
different MCU (e.g. a 3.3 V SAMD board such as Gemma M0 / Flora).

## Decision

Use **PlatformIO** as the build/dependency/upload tool, targeting the
**Arduino framework**. Configuration lives in `platformio.ini`, with a per-board
environment (`[env:uno]` first). Libraries (e.g. Adafruit NeoPixel) are declared
via `lib_deps` and version-pinned.

## Consequences

- Reproducible CLI builds (`pio run`), uploads (`pio run -t upload`), and serial
  monitoring (`pio device monitor`) — scriptable and CI-friendly.
- Declarative, pinned dependencies instead of the IDE's global library mess.
- Switching/adding boards is a new `[env:*]` block; the Arduino framework keeps
  most application code portable across AVR and SAMD targets.
- Slightly more upfront config than the Arduino IDE, and contributors must
  install PlatformIO. Acceptable for a deliberate, long-lived project.

## Alternatives considered

- **Arduino IDE sketch** — lowest friction, but no real dependency pinning, no
  CLI/CI story, awkward multi-board support. Rejected.
- **Bare avr-gcc / Makefile** — maximal control, but we'd reinvent board
  definitions, upload, and the Arduino HAL the NeoPixel library expects.
  Rejected as premature.
