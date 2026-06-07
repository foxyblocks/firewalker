#pragma once

// Central knobs for the Firewalker bring-up firmware. Keeping pin / count /
// brightness / baud here (not scattered through main.cpp) makes the hardware
// assumptions explicit and easy to change as wiring is confirmed.
//
// Strip-type flags (NEO_GRB, NEO_KHZ800) intentionally live in firewalker_core.cpp next
// to the Adafruit_NeoPixel include.

#include <Arduino.h>

// ── Serial ──────────────────────────────────────────────────────────────
// Must match `monitor_speed` in platformio.ini.
constexpr unsigned long SERIAL_BAUD = 115200;

// ── NeoPixel strip ──────────────────────────────────────────────────────
// Feather RP2040 silk D5. The installed board variant maps D5 -> GPIO 7.
constexpr uint8_t  LED_PIN = D5;

// Number of pixels driven — set to the current strip length (39). Total
// current scales with this count, so keep it honest. See docs/power-budget.md.
constexpr uint16_t LED_COUNT = 39;

// Global brightness (0-255). Total current scales with this, so raising it eats
// into the USB budget fast — see docs/power-budget.md before pushing it up.
constexpr uint8_t  LED_BRIGHTNESS = 100;   // 0-255

// Light the first pixel after boot so strip power/data wiring can be checked
// without needing the serial monitor to catch setup() logs.
constexpr bool    BOOT_PIXEL_DEBUG = true;
constexpr uint8_t BOOT_PIXEL_INDEX = 0;
constexpr uint8_t BOOT_PIXEL_R     = 0;
constexpr uint8_t BOOT_PIXEL_G     = 255;
constexpr uint8_t BOOT_PIXEL_B     = 0;

// ── FSR stomp sensor ────────────────────────────────────────────────────
// Force-sensitive resistor voltage divider on Feather analog A0:
// Observed behavior: baseline is roughly 100-300, hard pressure rises toward
// 700-1000.
constexpr uint8_t       FSR_PIN = A0;
constexpr int           FSR_STOMP_THRESHOLD = 700;
constexpr int           FSR_RELEASE_THRESHOLD = 400;
constexpr unsigned long FSR_SAMPLE_MS = 50;

// When no trails are active, show live FSR pressure as yellow strip brightness.
// Map the observed FSR range to brightness: baseline/rest is roughly 100-300,
// hard squeeze trends toward 700-1000.
constexpr int           FSR_ANALOG_MIN = 100;
constexpr int           FSR_ANALOG_MAX = 1000;
constexpr uint8_t       FSR_IDLE_MIN_BRIGHTNESS = 3;
constexpr uint8_t       FSR_IDLE_YELLOW_R = 255;
constexpr uint8_t       FSR_IDLE_YELLOW_G = 200;
constexpr uint8_t       FSR_IDLE_YELLOW_B = 0;

#if defined(FIREWALKER_MODE_FSR_DEBUG)
constexpr bool FSR_DEBUG = true;
constexpr bool FSR_IDLE_VISUAL_DEBUG = true;
#elif defined(FIREWALKER_MODE_FINAL_APP)
constexpr bool FSR_DEBUG = false;
constexpr bool FSR_IDLE_VISUAL_DEBUG = false;
#else
#error "Define one Firewalker mode: FIREWALKER_MODE_FINAL_APP or FIREWALKER_MODE_FSR_DEBUG"
#endif

// ── Debug button ────────────────────────────────────────────────────────
// Momentary button wired between Feather RP2040 silk D6 and GND, using the
// internal pull-up. Kept alongside the FSR so trails can still be triggered
// during bench testing without pressing the shoe sensor.
constexpr bool          DEBUG_BUTTON_ENABLED = true;
constexpr uint8_t       DEBUG_BUTTON_PIN = D6;
constexpr unsigned long DEBUG_BUTTON_DEBOUNCE_MS = 30;
constexpr bool          DEBUG_BUTTON_LOG = FSR_DEBUG;

// ── Trail color (fire gradient) ─────────────────────────────────────────────
// Palette stops from the hot head to the cool tail, as plain R/G/B. The shared
// core interpolates these across the band length and caches the result. Edit /
// add / remove stops to retune the flame — FIRE_STOPS updates automatically. Note the
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
// Each stomp trigger spawns a TRAIL: a band of TRAIL_LEN lit pixels that travels
// bottom -> top at one pixel per WIPE_STEP_MS. It "wipes in" as it emerges from
// the bottom and "wipes out" as it slides off the top — no hold in between.
// Presses stack: multiple trails run at once, each behind the previous, up to
// MAX_TRAILS (further presses are ignored until a slot frees up).
constexpr unsigned long WIPE_STEP_MS = 10;   // ms per one-pixel advance (timing you tuned)
constexpr uint8_t       TRAIL_LEN    = 30;   // band length in pixels (the wipe-in/out width)
constexpr uint8_t       MAX_TRAILS   = 12;   // max simultaneous trails on the strip
