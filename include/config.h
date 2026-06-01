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

// Global brightness (0-255). Total current scales with this, so raising it eats
// into the USB budget fast — see docs/power-budget.md before pushing it up.
constexpr uint8_t  LED_BRIGHTNESS = 100;   // 0-255

// ── Button (stomp simulator) ────────────────────────────────────────────
// Momentary button wired between pin 10 and GND, using the AVR internal
// pull-up: the pin reads HIGH at rest and LOW when pressed (no external
// resistor needed). Stands in for a future accelerometer step-detect.
// See docs/wiring.md.
constexpr uint8_t       BUTTON_PIN  = 10;
constexpr unsigned long DEBOUNCE_MS = 30;   // ignore contact bounce shorter than this

// ── Trail color (fire gradient) ─────────────────────────────────────────────
// Palette stops from the hot head to the cool tail, as plain R/G/B. main.cpp
// interpolates these across the band length and caches the result. Edit / add /
// remove stops to retune the flame — FIRE_STOPS updates automatically. Note the
// white head draws more current than a single-color fill; worst case is still
// the whole strip lit at once. See docs/power-budget.md.
constexpr uint8_t FIRE[][3] = {
  {255, 200, 0},  // head  — white-hot
  {255, 150,   0},  // yellow
  {255, 60,   0},  // orange
  {255,   20,   0},  // tail  — red
};
constexpr uint8_t FIRE_STOPS = sizeof(FIRE) / sizeof(FIRE[0]);

// ── Trail animation ─────────────────────────────────────────────────────
// Each button press spawns a TRAIL: a band of TRAIL_LEN lit pixels that travels
// bottom -> top at one pixel per WIPE_STEP_MS. It "wipes in" as it emerges from
// the bottom and "wipes out" as it slides off the top — no hold in between.
// Presses stack: multiple trails run at once, each behind the previous, up to
// MAX_TRAILS (further presses are ignored until a slot frees up).
constexpr unsigned long WIPE_STEP_MS = 10;   // ms per one-pixel advance (timing you tuned)
constexpr uint8_t       TRAIL_LEN    = 30;   // band length in pixels (the wipe-in/out width)
constexpr uint8_t       MAX_TRAILS   = 12;   // max simultaneous trails on the strip
