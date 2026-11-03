# Wiring

How the Seeed XIAO MG24 Sense connects to the BTF FCOB strip. There's no sensor wiring,
because the motion sensor is on the board, and there are no buttons, because the remote
handles control.

## Connections

| From (XIAO MG24) | To (strip) | Notes |
|---|---|---|
| **D10** | **DIN** | At the strip's input end. Its arrows point away from the board. |
| **GND** | **GND** | A common ground is mandatory, even when the strip has its own supply. |
| **5V** | **+5V** | For USB bench work only. See below. |

D10 is the chip's PA5. If the data pin ever moves, `LED_PIN` in
[`config.h`](../include/config.h) and the port writes in
[`firewalker_strip.cpp`](../src/firewalker_strip.cpp) have to move together.

## Power

There are two supported setups. [`power-budget.md`](power-budget.md) has the current
math behind them.

**USB bench.** Feed the strip from the board's 5V pad, which exposes USB power. Seeed
recommends keeping peripheral load on that pad under 500 mA. The firmware's brightness
cap keeps a full-white frame near 400 mA by the strip's rating.

**External 5 V.** Feed the strip directly from a 5 V supply rated at least 2 A, keep
the board on USB or its own supply, and tie the grounds together. Leave the board's 5V
pad disconnected from that supply. Use this for anything brighter than the cap.

The 5V pad is not a boosted battery output, and the final battery design is still open.

## Signal integrity

The bench rig runs D10's 3.3 V data straight into the strip's input, and that works on
the tested strip. Add these if the strip flickers or a longer run gets unreliable:

- A **330 Ω resistor** in series with DIN, close to the strip, to damp ringing.
- A **1000 µF capacitor** across the strip's +5V and GND at the input, to absorb
  current surges, especially with an external supply.
- A **3.3 V to 5 V level shifter** on the data line, for a strip that won't read 3.3 V
  data reliably.

Connect GND first and disconnect it last, and don't hot-plug the strip's data line while
it's powered.

## Troubleshooting a dark strip

1. Reseat the board and check the connections first. A dark strip on the bench once
   turned out to be the board not sitting fully in the breadboard.
2. Check that the onboard LED is lit. If it isn't, the firmware isn't running.
3. Check for about 5 V between the strip's +5V and GND, and that you're wired to its
   input end rather than its output end.
4. Run `./cli color --lit 4 --brightness 16`, which lights only the first four pixels.
   Open a USB console and check that the firmware reports `[firewalker] mode=bench`.
5. If the strip shows the wrong pixels or random colors, suspect the signal rather than
   the power: try the resistor and level shifter above.
