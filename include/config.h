#pragma once

// Central knobs for the Firewalker firmware: every pin, strip, brightness, motion,
// and pattern setting lives here, named by the module that owns it. Build flags
// may override the strip size, layout, and brightness for test builds.

#include <Arduino.h>
#include <stddef.h>

#include "firewalker_calibration.h"

// ── Serial ──────────────────────────────────────────────────────────────
// Must match `monitor_speed` in platformio.ini.
constexpr unsigned long SERIAL_BAUD = 115200;

// ── Strip ───────────────────────────────────────────────────────────────
// BTF FCOB-5V-160L-W-IP30-SPI-5MM: a nominal 1m of 160 individually addressable
// pixels, XGB1338 (WS2812B-compatible, GRB, 800 kHz). Data is on D10, which is SPI
// MOSI. The signal comes from the SPI hardware, so it can't move to another pin freely.

// Connected pixel count and ring layout. These describe the uncut bench strip, and the
// ring positions scale the original 40-pixel ring by four. A boot needs about 69 cm, or
// about 110 pixels, so set all three once the strip is cut (see docs/open-questions.md).
// The cli tool reads them from here too. Test builds override them with build flags, and
// every source file sees the same values.
#ifndef FIREWALKER_LED_COUNT
#define FIREWALKER_LED_COUNT 160
#endif
#ifndef FIREWALKER_STRIP_TOE_INDEX
#define FIREWALKER_STRIP_TOE_INDEX 52
#endif
#ifndef FIREWALKER_STRIP_HEEL_INDEX
#define FIREWALKER_STRIP_HEEL_INDEX 132
#endif
constexpr uint16_t LED_COUNT = FIREWALKER_LED_COUNT;

// The strip is a closed loop around the foot perimeter: pixel 0 starts directly
// under the controller, then the indices run forward to the toe apex, back along
// the other side to the heel, and return to the start. The pure index-to-fore-aft
// math lives in include/firewalker_strip_map.h (tested in test/test_strip_map).
constexpr uint16_t STRIP_TOE_INDEX  = FIREWALKER_STRIP_TOE_INDEX;
constexpr uint16_t STRIP_HEEL_INDEX = FIREWALKER_STRIP_HEEL_INDEX;
static_assert(LED_COUNT > 0 && STRIP_TOE_INDEX < STRIP_HEEL_INDEX &&
                  STRIP_HEEL_INDEX < LED_COUNT,
              "Strip layout must satisfy toe < heel < pixel count");

// Signal timing. src/firewalker_strip.cpp turns each LED bit into four bits of SPI at
// this rate, which sets every pulse width. 3.25 MHz divides evenly from the board's
// 39 MHz clock. Re-check black frames, fixed colors, and animations on the real strip
// after any change, because a successful upload doesn't verify the signal.
constexpr uint32_t STRIP_SPI_HZ   = 3250000;
constexpr uint32_t STRIP_LATCH_US = 300;

// Default brightness (0-255) on first boot. After that each controller restores
// its own saved value. Brightness scales requested color and is not a current
// limit. Build flags set it for test builds.
#ifndef FIREWALKER_LED_BRIGHTNESS
#define FIREWALKER_LED_BRIGHTNESS 16
#endif
constexpr uint8_t LED_BRIGHTNESS = FIREWALKER_LED_BRIGHTNESS;

// Highest brightness the remote may set. The uncut 160-pixel strip is rated about 1.6 A
// at full white, so 64/255 keeps a full-white frame near 400 mA, inside the 500 mA the
// XIAO's USB-fed 5V pad should supply. docs/power-budget.md has the numbers for a cut
// strip and for a dedicated 5V supply.
#ifndef FIREWALKER_LED_BRIGHTNESS_MAX
#define FIREWALKER_LED_BRIGHTNESS_MAX 64
#endif
constexpr uint8_t LED_BRIGHTNESS_MIN = 1;
constexpr uint8_t LED_BRIGHTNESS_MAX = FIREWALKER_LED_BRIGHTNESS_MAX;
static_assert(LED_BRIGHTNESS >= LED_BRIGHTNESS_MIN && LED_BRIGHTNESS <= 255,
              "Default brightness must be at least LED_BRIGHTNESS_MIN");

// ── Onboard status LED ───────────────────────────────────────────────────
// Half-periods of the onboard LED's blink patterns (firewalker_core.h StatusLight).
constexpr unsigned long STATUS_BLINK_SLOW_MS = 500;
constexpr unsigned long STATUS_BLINK_FAST_MS = 100;

// ── IMU motion sensor (onboard LSM6DS3TR-C) ─────────────────────────────
// The MG24 Sense's onboard accel + gyro, on the default I2C bus. PD5 powers it and
// must go high before the sensor starts. src/firewalker_imu.cpp converts readings
// to m/s^2 *including* gravity and rad/s, so at rest the total magnitude sits near
// 9.81 and a stomp is a spike well above it.
constexpr uint8_t       IMU_I2C_ADDR = 0x6A;
constexpr uint8_t       IMU_ENABLE_PIN = PD5;
constexpr unsigned long IMU_SAMPLE_MS = 20;    // ~50 Hz accel/gyro poll
constexpr unsigned long IMU_LOG_MS = 100;      // throttle verbose serial to ~10 Hz
constexpr float         IMU_GRAVITY = 9.81f;   // rest |accel| baseline (m/s^2)

// Stomp detect on total acceleration magnitude with hysteresis + a refractory
// gap. Starting points to tune on a real foot (see open-questions.md).
constexpr float         IMU_STOMP_ACCEL_THRESHOLD   = 18.0f;  // fire above this |accel|
constexpr float         IMU_RELEASE_ACCEL_THRESHOLD = 12.0f;  // re-arm below this |accel|
constexpr unsigned long IMU_REFRACTORY_MS = 250;              // min gap between stomps

// Stomp "force" → trail brightness. imuStompStrength() normalizes the |accel| at
// the trigger sample from the threshold (0) up to IMU_STOMP_FORCE_FULL (1); a
// firm stomp spikes higher than a gentle step, so harder steps drive brighter
// trails. The trigger itself is unchanged — this only reads how hard it hit.
constexpr float         IMU_STOMP_FORCE_FULL = 40.0f;  // |accel| (m/s^2) → full-brightness trail

// ── Orientation fusion ───────────────────────────────────────────────────
// Axes and signs live in include/firewalker_mg24_mount.h, shared with the native
// motion tests.
constexpr float   IMU_FILTER_ALPHA  = 0.96f;  // complementary-filter weight on the gyro term

// ── Tilt calibration ─────────────────────────────────────────────────────
// How fused angles become tilt (include/firewalker_calibration.h). A side with no
// captured heel or toe pose reaches full tilt at IMU_TILT_FULL_DEG from neutral. The dead
// zone is in degrees and covers the capture's spread limit below, so a calibrated boot
// rests exactly flat.
constexpr float   IMU_TILT_FULL_DEG     = 30.0f;
constexpr float   IMU_TILT_DEADZONE_DEG = 3.0f;
constexpr Firewalker::TiltLimits TILT_LIMITS = {
    IMU_TILT_FULL_DEG,
    IMU_TILT_DEADZONE_DEG,
    10.0f,  // a heel or toe pose must sit at least this far from neutral
    45.0f,  // a neutral pose must sit within this of sensor level
};

// Bounds for holding a pose still. These are starting values, confirmed only on a still
// bench so far, and may need loosening for a pose held on a foot (docs/open-questions.md).
constexpr unsigned long CALIBRATION_WINDOW_MS    = 1000;   // how long the boot must hold still
constexpr unsigned long CALIBRATION_NO_SAMPLE_MS = 500;    // gap in sensor samples that fails a capture
constexpr uint16_t      CALIBRATION_MIN_SAMPLES  = 25;     // half the samples expected at 50 Hz
constexpr float         CALIBRATION_MAX_RANGE_DEG = 3.0f;  // max spread of the angle across the window
constexpr float         CALIBRATION_MAX_GYRO_RADS = 0.25f; // about 14 deg/s of any rotation
constexpr float         CALIBRATION_MAX_ACCEL_DEV = 1.5f;  // m/s^2 away from gravity

// ── Saved settings ───────────────────────────────────────────────────────
// A burst of slider changes turns into one flash write: it saves after the changes
// pause, or after the longest delay if they never do.
constexpr unsigned long SETTINGS_SAVE_QUIET_MS = 1000;
constexpr unsigned long SETTINGS_SAVE_MAX_MS   = 5000;

// ── Remote control ───────────────────────────────────────────────────────
// Shared by the BLE service and the USB console (docs/remote-protocol.md).
constexpr unsigned long REMOTE_MOTION_REPORT_MS = 200;  // motion lines while debug is on
constexpr unsigned long REMOTE_STATUS_MIN_MS    = 250;  // fastest repeat of change-driven status lines
constexpr uint16_t      REMOTE_ADVERTISE_INTERVAL = 160;   // BLE advertising interval, in 0.625 ms units (100 ms)
constexpr uint8_t       REMOTE_RX_QUEUE_DEPTH     = 8;     // BLE commands waiting for the main loop
constexpr size_t        REMOTE_TX_BUFFER_BYTES    = 1024;  // reply bytes waiting to go out over BLE
constexpr size_t        REMOTE_ATT_VALUE_MAX      = 244;   // largest notification payload the firmware will send
constexpr uint8_t       REMOTE_NOTIFICATIONS_PER_LOOP = 4; // cap per main-loop pass, so sending can't stall it
constexpr unsigned long IDENTIFY_MS       = 1500;  // how long `identify` blinks the strip
constexpr unsigned long IDENTIFY_BLINK_MS = 125;   // half-period of that blink
constexpr unsigned long APP_FRAME_MS            = 16;   // shortest time between strip frames
constexpr unsigned long APP_OFF_REFRESH_MS      = 1000; // black refresh when off, in case the strip repowers

// ── Idle fill (imu_debug visual) ─────────────────────────────────────────
// imu_debug fills the strip a solid color scaled by motion (the app uses the
// flow / fire-trail patterns instead).
constexpr uint8_t IDLE_MIN_BRIGHTNESS = 3;   // floor so a still IMU still glows faintly
constexpr uint8_t IDLE_FILL_R = 255;         // warm yellow
constexpr uint8_t IDLE_FILL_G = 200;
constexpr uint8_t IDLE_FILL_B = 0;

// ── Flow pattern (fill gauge + spectrum cycle + stomp trails) ────────────
// The whole strip shares one hue that slowly rotates through the spectrum; tilt
// drives a fill gauge. At level every pixel is lit at FLOW_BASELINE. As the foot
// tilts, pixels extinguish one-by-one from the up-end (each fades across its own
// ~1-pixel span of tilt) so the lit band shrinks toward the down-most end, while
// the surviving pixels brighten toward full. At full tilt (IMU_TILT_FULL_DEG,
// 30°) a single pixel remains lit at the down-most end. A tilted stomp launches
// directional trails from the down-point; a flat stomp instead flashes the strip
// white (FLOW_FLASH_MS). See ADR-0002/0003 and CONTEXT.md (Flow).
constexpr float   FLOW_BASELINE = 0.80f;  // flat per-pixel brightness (0..1); surviving end → 100% at full tilt

// A flat stomp has no tilt direction to pour toward, so instead of a trail it
// flashes the whole strip white and fades back to the flow color over this span.
constexpr unsigned long FLOW_FLASH_MS = 800;

constexpr unsigned long FLOW_HUE_CYCLE_MS = 15000;  // ms for one full spectrum rotation

// Stomp trails: each stomp launches up to 4 fronts from the tilt-derived "down"
// point (toe-down→toe, heel-down→heels, flat→mid-foot ~25%/75%), each diverging
// along its side to the heel and toe ends. Band gradient: white head → current
// hue (full) → the previous hue in the rotation.
constexpr float    FLOW_TRAIL_SPEED_PXPS = 45.0f;  // front travel speed (pixels/sec)
constexpr uint8_t  FLOW_TRAIL_LEN        = 12;     // band length (pixels)
constexpr uint16_t FLOW_TRAIL_PREV_HUE   = 7300;   // tail hue step back (~40° on the 0..65535 wheel)
constexpr uint8_t  FLOW_MAX_FRONTS       = 16;     // 4 per stomp; supports ~4 concurrent stomps
constexpr float    FLOW_TRAIL_BRIGHT_MIN = 0.30f;  // trail brightness at a threshold-force stomp (→1.0 at IMU_STOMP_FORCE_FULL)

// Strip geometry (ring, toe/heel indices) lives in the Strip section above
// (STRIP_TOE_INDEX / STRIP_HEEL_INDEX) — it's a hardware fact, not a flow knob.

// ── Fire-trail pattern: gradient palette ─────────────────────────────────
// Palette stops from the hot head to the cool tail, as plain R/G/B. The
// fire-trail pattern interpolates these across the band length and caches the
// result. Edit / add / remove stops to retune the flame — FIRE_STOPS updates
// automatically. Note the white head draws more current than a single-color
// fill; worst case is still the whole strip lit at once. See docs/power-budget.md.
constexpr uint8_t FIRE[][3] = {
  {255, 200, 0},  // head  — white-hot
  {255, 150,   0},  // yellow
  {255, 60,   0},  // orange
  {255,   20,   0},  // tail  — red
};
constexpr uint8_t FIRE_STOPS = sizeof(FIRE) / sizeof(FIRE[0]);

// ── Fire-trail pattern: band animation ───────────────────────────────────
// Each stomp spawns a trail: a band of FIRE_TRAIL_LEN lit pixels that travels
// bottom -> top at one pixel per FIRE_TRAIL_STEP_MS. It "wipes in" as it emerges
// from the bottom and "wipes out" as it slides off the top — no hold in between.
// Stomps stack: multiple trails run at once, each behind the previous, up to
// FIRE_TRAIL_MAX (further stomps are ignored until a slot frees up).
constexpr unsigned long FIRE_TRAIL_STEP_MS = 10;  // ms per one-pixel advance
constexpr uint8_t       FIRE_TRAIL_LEN     = 30;  // band length in pixels (the wipe-in/out width)
constexpr uint8_t       FIRE_TRAIL_MAX     = 12;  // max simultaneous trails on the strip
