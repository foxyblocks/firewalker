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
constexpr uint8_t  LED_PIN = D11;

// Number of pixels driven — the full strip (exactly 40). Total current scales
// with this count, so keep it honest. See docs/power-budget.md.
constexpr uint16_t LED_COUNT = 40;

// Strip ring geometry (measured on the FOX-183 mount). The strip is a closed
// loop around the foot perimeter: pixel 0 starts at the inner ankle directly
// under the controller, runs forward along the medial side to the toe apex,
// back along the lateral side to the heel, then returns to the start. Both
// arcs between toe and heel are exactly 20 steps. The pure index→fore-aft
// math lives in include/firewalker_strip_map.h (tested in test/test_strip_map).
constexpr uint16_t STRIP_TOE_INDEX  = 13;
constexpr uint16_t STRIP_HEEL_INDEX = 33;

// ── Foot side ────────────────────────────────────────────────────────────
// Both shoes carry an identical hardware build (controller on the inner ankle,
// USB up the leg), but the two GY-521 IMUs ended up mounted inverted about the
// heel↔toe axis from each other: the RIGHT boot sits VCC-down, the LEFT boot
// VCC-up (USB-port side up, SDA/SCL toward the ground). That 180° flip about
// the fore-aft axis reverses the vertical and board-normal axes while leaving
// the heel↔toe axis aligned with travel — so the vertical and pitch-gyro signs
// differ per foot, while the fore-aft sign is the same on both. The per-foot
// signs are set in the IMU mount section below. Select per shoe with the
// final_app_left / final_app_right PlatformIO envs (-DFIREWALKER_FOOT_LEFT /
// -DFIREWALKER_FOOT_RIGHT); plain final_app and imu_debug default to RIGHT. The
// boot log prints which foot is running. Both boots are bench-confirmed
// (imu_debug, 2026-06-11).
#if defined(FIREWALKER_FOOT_LEFT) && defined(FIREWALKER_FOOT_RIGHT)
#error "Define at most one of FIREWALKER_FOOT_LEFT / FIREWALKER_FOOT_RIGHT"
#endif
#if defined(FIREWALKER_FOOT_LEFT)
constexpr bool  FOOT_IS_LEFT = true;
#else
constexpr bool  FOOT_IS_LEFT = false;   // default: right foot
#endif

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

// Stomp "force" → trail brightness. imuStompStrength() normalizes the |accel| at
// the trigger sample from the threshold (0) up to IMU_STOMP_FORCE_FULL (1); a
// firm stomp spikes higher than a gentle step, so harder steps drive brighter
// trails. The trigger itself is unchanged — this only reads how hard it hit.
constexpr float         IMU_STOMP_FORCE_FULL = 40.0f;  // |accel| (m/s^2) → full-brightness trail

// imu_debug motion visual: map movement intensity (|accel| - gravity) to the
// idle fill brightness so the strip shows how hard the IMU is being shaken.
constexpr float         IMU_ACCEL_DELTA_MIN = 0.5f;   // below this reads as "still"
constexpr float         IMU_ACCEL_DELTA_MAX = 12.0f;  // saturates idle brightness here

// ── IMU mount + orientation fusion ───────────────────────────────────────
// Orientation → fore-aft tilt. Mount (FOX-183 carrier): board ~vertical on the
// inner ankle, USB up the leg. At rest one in-plane accel axis reads ~gravity
// (the "up" axis, Y) and the heel↔toe axis (X) reads small; pitching the foot
// is rotation about the board normal (Z), so gyro Z is the pitch rate. Axis
// indices/signs are 0=X,1=Y,2=Z. The heel↔toe axis (X) points the same way on
// both boots, so its sign is foot-independent; the vertical (Y) and board-normal
// (Z) axes are reversed between boots by the VCC-up/down mount inversion (see
// "Foot side"), so their signs are set per foot below.
//
// Bench-confirmed (imu_debug, 2026-06-11):
//   RIGHT: rest a=(+0.6,-9.4,-3.6) → gravity on -Y; toe-down swings ax to ~-4.4;
//          tilt reads +0.83 toe-down.            Signs V=-1, FA=-1, P=+1.
//   LEFT:  rest a=(+2.9,+9.5,+0.9) → gravity on +Y (VCC-up); toe-down ax +2.9→-1.6,
//          heel-down ax→+6.7; pitch corr(gyroZ,dTilt)=-0.96. Signs V=+1, FA=-1, P=-1.
//   Sole-flat fore-aft cant (trimmed via IMU_MOUNT_FOREAFT_REST_DEG below): LEFT
//   -12.5° (measured), RIGHT -3.7° — so a flat foot reads level, not heel-down.
constexpr uint8_t IMU_MOUNT_FOREAFT_AXIS    = 0;      // accel X = heel↔toe
constexpr float   IMU_MOUNT_FOREAFT_SIGN    = -1.0f;  // toe-down → ax<0 → +tilt (both boots)
constexpr uint8_t IMU_MOUNT_VERTICAL_AXIS   = 1;      // accel Y = vertical at rest
constexpr uint8_t IMU_MOUNT_PITCH_GYRO_AXIS = 2;      // gyro Z = pitch rate (board normal)
#if defined(FIREWALKER_FOOT_LEFT)
constexpr float   IMU_MOUNT_VERTICAL_SIGN    = +1.0f;  // left: VCC-up mount, +Y points up
constexpr float   IMU_MOUNT_PITCH_GYRO_SIGN  = -1.0f;  // left: board normal flipped
constexpr float   IMU_MOUNT_FOREAFT_REST_DEG = -12.5f; // measured sole-flat fore-aft cant
#else
constexpr float   IMU_MOUNT_VERTICAL_SIGN    = -1.0f;  // right: VCC-down mount, -Y points up
constexpr float   IMU_MOUNT_PITCH_GYRO_SIGN  = +1.0f;  // right: matches toe-down rate
constexpr float   IMU_MOUNT_FOREAFT_REST_DEG = -3.7f;  // sole-flat fore-aft cant (from bench rest)
#endif
constexpr float   IMU_FILTER_ALPHA  = 0.96f;  // complementary-filter weight on the gyro term
// imuTiltFwd() subtracts IMU_MOUNT_FOREAFT_REST_DEG (so a sole-flat foot reads
// level despite the mount's cant), then saturates at ±1 at IMU_TILT_FULL_DEG of
// tilt *from flat* — i.e. the pool fully pours at ~30° toe-down or heel-down.
constexpr float   IMU_TILT_FULL_DEG = 30.0f;

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

// Strip geometry (ring, toe/heel indices) lives in the NeoPixel section above
// (STRIP_TOE_INDEX / STRIP_HEEL_INDEX) — it's a hardware fact, not a flow knob.

// Ignore tiny tilts near level (residual mount cant / wobble) so the strip rests
// flat; past the deadzone the remaining range is rescaled to still reach full
// pooling. The bulk of the mount cant is already removed by the per-foot
// IMU_MOUNT_FOREAFT_REST_DEG trim; this is the small flat band on top of that.
constexpr float   FLOW_TILT_DEADZONE = 0.10f;  // normalized tilt (0..1) ≈ 3° at 30° full

// ── D6 button ────────────────────────────────────────────────────────────
// Momentary button between Feather silk D6 and GND, internal pull-up. In the
// app it cycles patterns; in imu_debug it's a bench input.
constexpr bool          DEBUG_BUTTON_ENABLED = true;
constexpr uint8_t       DEBUG_BUTTON_PIN = D6;
constexpr unsigned long DEBUG_BUTTON_DEBOUNCE_MS = 30;
constexpr bool          DEBUG_BUTTON_LOG = false;

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
