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

// ── IMU motion sensor (MPU-6050 / GY-521) ───────────────────────────────
// GY-521 breakout (MPU-6050: 3-axis accel + 3-axis gyro) read over I2C on the
// Feather's SDA/SCL pins — the shoe's motion sensor, used by the app
// (final_app) and imu_debug (see docs/wiring-mpu6050.md). The Adafruit MPU6050
// library reports acceleration in m/s^2 *including* gravity, so at rest the
// total magnitude sits near 9.81; a stomp/step is a spike well above it.
constexpr uint8_t       IMU_I2C_ADDR = 0x68;   // AD0 low; 0x69 if AD0 tied high
constexpr unsigned long IMU_SAMPLE_MS = 20;    // ~50 Hz accel/gyro poll
constexpr unsigned long IMU_LOG_MS = 100;      // throttle verbose serial to ~10 Hz
constexpr float         IMU_GRAVITY = 9.81f;   // rest |accel| baseline (m/s^2)

// Stomp detect on total acceleration magnitude with hysteresis + a refractory
// gap. Starting points to tune on a real foot (see open-questions.md).
constexpr float         IMU_STOMP_ACCEL_THRESHOLD   = 18.0f;  // fire above this |accel|
constexpr float         IMU_RELEASE_ACCEL_THRESHOLD = 12.0f;  // re-arm below this |accel|
constexpr unsigned long IMU_REFRACTORY_MS = 250;              // min gap between stomps

// imu_debug motion visual: map movement intensity (|accel| - gravity) to the
// idle fill brightness so the strip shows how hard the IMU is being shaken.
constexpr float         IMU_ACCEL_DELTA_MIN = 0.5f;   // below this reads as "still"
constexpr float         IMU_ACCEL_DELTA_MAX = 12.0f;  // saturates idle brightness here

// ── Idle fill (imu_debug visual) ─────────────────────────────────────────
// imu_debug fills the strip a solid color scaled by motion (the app uses the
// flow / fire-trail patterns instead).
constexpr uint8_t IDLE_MIN_BRIGHTNESS = 3;   // floor so a still IMU still glows faintly
constexpr uint8_t IDLE_FILL_R = 255;         // warm yellow
constexpr uint8_t IDLE_FILL_G = 200;
constexpr uint8_t IDLE_FILL_B = 0;

// ── Flow pattern (orientation-driven magenta pooling) ────────────────────
// All pixels magenta at a half baseline; tilt redistributes brightness toward
// the down-end; a stomp doubles brightness then eases back. See ADR-0002/0003.
constexpr uint8_t FLOW_COLOR_R = 255;        // magenta
constexpr uint8_t FLOW_COLOR_G = 0;
constexpr uint8_t FLOW_COLOR_B = 255;
constexpr float   FLOW_BASELINE = 0.5f;      // resting per-pixel level (0..1); half so a stomp can double
constexpr float   FLOW_GAIN     = 1.0f;      // how strongly tilt redistributes brightness
constexpr float   FLOW_STOMP_PEAK   = 2.0f;  // stomp multiplies current brightness by this
constexpr float   FLOW_STOMP_TAU_MS = 270.0f;// ease-out time constant (~3·tau ≈ 800 ms fade)

// Strip-as-loop geometry: heel→toe→heel, so the toe is mid-strip and the heel is
// at both ends. The apex index is a measured constant (count it on the bench;
// the two sides may not have equal pixel counts). See CONTEXT.md (Strip).
constexpr uint8_t FLOW_TOE_INDEX = (LED_COUNT - 1) / 2;  // ~19 — confirm on hardware

// Orientation → fore-aft tilt. Mount: Feather on its side on the outer ankle,
// USB→heel, GY-521 co-mounted. At rest (board on its side) one in-plane accel
// axis reads ~gravity (the "up" axis) and the heel↔toe axis reads ~0; pitching
// the foot is rotation about the board normal, so the gyro's normal axis is the
// pitch rate. These axis indices/signs (0=X,1=Y,2=Z) are a GUESS — confirm with
// imu_debug (watch which axis tracks heel↔toe) and flip a sign if flow runs
// backward. See open-questions.md.
// Confirmed on the bench (imu_debug) for the ankle mount, Feather long-axis
// vertical / USB up, chip side out: at rest gravity sits on +Y (~9.84); pitching
// toe-down swings ax to ~-5.8 (X = heel↔toe) while Z (~0) is the lateral board
// normal. Fore-aft sign is negative so toe-down → +tilt → pools toward the toe.
constexpr uint8_t FLOW_FOREAFT_AXIS   = 0;      // accel X = heel↔toe
constexpr float   FLOW_FOREAFT_SIGN   = -1.0f;  // toe-down → +tilt (pools toward the toe)
constexpr uint8_t FLOW_VERTICAL_AXIS  = 1;      // accel Y = vertical at rest
constexpr float   FLOW_VERTICAL_SIGN  = 1.0f;
constexpr uint8_t FLOW_PITCH_GYRO_AXIS = 2;     // gyro Z = pitch rate (board normal)
constexpr float   FLOW_PITCH_GYRO_SIGN = 1.0f;
constexpr float   FLOW_FILTER_ALPHA  = 0.96f;  // complementary-filter weight on the gyro term
constexpr float   FLOW_TILT_FULL_DEG = 35.0f;  // tilt angle that saturates the gradient
// Ignore tiny tilts near level (mount offset / wobble) so the strip rests flat;
// past the deadzone the remaining range is rescaled to still reach full pooling.
constexpr float   FLOW_TILT_DEADZONE = 0.12f;  // normalized tilt (0..1)

// ── D6 button ────────────────────────────────────────────────────────────
// Momentary button between Feather silk D6 and GND, internal pull-up. In the
// app it cycles patterns; in imu_debug it's a bench input.
constexpr bool          DEBUG_BUTTON_ENABLED = true;
constexpr uint8_t       DEBUG_BUTTON_PIN = D6;
constexpr unsigned long DEBUG_BUTTON_DEBOUNCE_MS = 30;
constexpr bool          DEBUG_BUTTON_LOG = false;

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
