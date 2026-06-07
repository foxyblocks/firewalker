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

// ── Onboard status NeoPixel ──────────────────────────────────────────────
// The Feather RP2040's built-in NeoPixel (PIN_NEOPIXEL -> GPIO 16; always
// powered on this board — no enable pin). Lit a solid color in every mode by
// setupCore() as a "powered / firmware running" indicator, independent of the
// main strip and of having a serial monitor attached. It's a single bright
// pixel right by the USB jack, so brightness is kept low.
constexpr bool    ONBOARD_PIXEL_ENABLED = true;
#if defined(PIN_NEOPIXEL)
constexpr uint8_t ONBOARD_PIXEL_PIN     = PIN_NEOPIXEL;
#else
constexpr uint8_t ONBOARD_PIXEL_PIN     = 16;   // Feather RP2040 onboard NeoPixel
#endif
constexpr uint8_t ONBOARD_PIXEL_BRIGHTNESS = 40;   // 0-255; it's bright up close
constexpr uint8_t ONBOARD_PIXEL_R = 255;           // warm amber, matching the fire theme
constexpr uint8_t ONBOARD_PIXEL_G = 60;
constexpr uint8_t ONBOARD_PIXEL_B = 0;

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
#elif defined(FIREWALKER_MODE_IMU_DEBUG)
// imu_debug drives the strip from the MPU-6050, not the FSR. The FSR analog
// path is left unused (and its debug logging off) in this mode.
constexpr bool FSR_DEBUG = false;
constexpr bool FSR_IDLE_VISUAL_DEBUG = false;
#else
#error "Define one Firewalker mode: FIREWALKER_MODE_FINAL_APP, FIREWALKER_MODE_FSR_DEBUG, or FIREWALKER_MODE_IMU_DEBUG"
#endif

// ── IMU stomp sensor (MPU-6050 / GY-521) ────────────────────────────────
// GY-521 breakout (MPU-6050: 3-axis accel + 3-axis gyro) read over I2C on the
// Feather's SDA/SCL pins. Candidate replacement for the FSR — only the
// imu_debug mode uses it today (see docs/wiring-mpu6050.md). The Adafruit
// MPU6050 library reports acceleration in m/s^2 *including* gravity, so at rest
// the total magnitude sits near 9.81; a stomp/step is a spike well above it.
constexpr uint8_t       IMU_I2C_ADDR = 0x68;   // AD0 low; 0x69 if AD0 tied high
constexpr unsigned long IMU_SAMPLE_MS = 20;    // ~50 Hz accel/gyro poll
constexpr unsigned long IMU_LOG_MS = 100;      // throttle verbose serial to ~10 Hz
constexpr float         IMU_GRAVITY = 9.81f;   // rest |accel| baseline (m/s^2)

// Stomp detect on total acceleration magnitude with hysteresis + a refractory
// gap, mirroring the FSR's arm/release. Starting points to tune on a real foot.
constexpr float         IMU_STOMP_ACCEL_THRESHOLD   = 18.0f;  // fire above this |accel|
constexpr float         IMU_RELEASE_ACCEL_THRESHOLD = 12.0f;  // re-arm below this |accel|
constexpr unsigned long IMU_REFRACTORY_MS = 250;              // min gap between stomps

// Idle visual: map movement intensity (|accel| - gravity) to the idle yellow
// brightness, reusing the FSR idle palette/brightness floor so the strip shows
// how hard the IMU is being shaken while watching the serial monitor.
constexpr float         IMU_ACCEL_DELTA_MIN = 0.5f;   // below this reads as "still"
constexpr float         IMU_ACCEL_DELTA_MAX = 12.0f;  // saturates idle brightness here

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
