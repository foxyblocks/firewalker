#pragma once

// Central knobs for the Firewalker bring-up firmware. Keeping pin / count /
// brightness / baud here (not scattered through main.cpp) makes the hardware
// assumptions explicit and easy to change as wiring is confirmed.
//
// Strip-type flags (NEO_GRB, NEO_KHZ800) intentionally live in main.cpp next
// to the Adafruit_NeoPixel include, so this header stays dependency-free.

#include <stdint.h>

// ── Serial ──────────────────────────────────────────────────────────────
// Must match `monitor_speed` in platformio.ini.
constexpr unsigned long SERIAL_BAUD = 115200;

// ── NeoPixel strip ──────────────────────────────────────────────────────
// DIN is wired to Uno digital pin 6 (Adafruit NeoPixel default). See
// docs/wiring.md for the full wiring assumptions.
constexpr uint8_t  LED_PIN   = 6;

// Number of pixels driven — set to the current strip length (39). Total
// current scales with this count, so keep it honest. See docs/power-budget.md.
constexpr uint16_t LED_COUNT = 39;

// Conservative global brightness (0-255) for USB-powered testing. The strip
// is powered from the Uno's USB 5V during bring-up, so this is capped low to
// stay under the ~500 mA USB budget. See docs/power-budget.md for the math.
constexpr uint8_t  LED_BRIGHTNESS = 60;   // ~12.5%

// ── Button (stomp simulator) ────────────────────────────────────────────
// Momentary button wired between pin 10 and GND, using the AVR internal
// pull-up: the pin reads HIGH at rest and LOW when pressed (no external
// resistor needed). Stands in for a future accelerometer step-detect.
// See docs/wiring.md.
constexpr uint8_t       BUTTON_PIN  = 10;
constexpr unsigned long DEBOUNCE_MS = 30;   // ignore contact bounce shorter than this

// ── Fill color ──────────────────────────────────────────────────────────
// Color the wipe paints, expressed pre-brightness as plain R/G/B (the GRB byte
// order is handled by Adafruit_NeoPixel::Color in main.cpp). A warm amber with
// one dominant channel keeps current below the white worst case — note the
// wipe ends with ALL LED_COUNT pixels lit at once. See docs/power-budget.md.
constexpr uint8_t  FILL_R = 255;
constexpr uint8_t  FILL_G = 60;
constexpr uint8_t  FILL_B = 0;

// ── Color-wipe animation ────────────────────────────────────────────────
// On each press the fill color wipes on one pixel at a time, bottom -> top,
// the lit region growing until the whole strip is on; it then holds briefly
// and clears, leaving the strip dark and ready for the next press.
constexpr unsigned long WIPE_STEP_MS = 10;   // interval between lighting each pixel (39 px ≈ 1 s)
constexpr unsigned long HOLD_MS      = 400;  // hold the full strip before clearing
