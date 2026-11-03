#pragma once

// Knobs for the retired Feather RP2040 + GY-521 build. config.h includes this only
// for the feather_* environments. It goes away with those environments.

// ── NeoPixel strip ──────────────────────────────────────────────────────
// Feather RP2040 silk D5. The installed board variant maps D5 -> GPIO 7.
constexpr uint8_t  LED_PIN = D11;

// Strip size and layout can be supplied by a prototype's build flags. Every
// source file receives the same values, so the strip buffer and pattern arrays
// agree on the pixel count. The default layout describes the 40-pixel shoe;
// the MG24 build.sh selects its 160-pixel bench strip and scaled ring positions.
#ifndef FIREWALKER_LED_COUNT
#define FIREWALKER_LED_COUNT 40
#endif
#ifndef FIREWALKER_STRIP_TOE_INDEX
#define FIREWALKER_STRIP_TOE_INDEX 13
#endif
#ifndef FIREWALKER_STRIP_HEEL_INDEX
#define FIREWALKER_STRIP_HEEL_INDEX 33
#endif
constexpr uint16_t LED_COUNT = FIREWALKER_LED_COUNT;

// Strip ring geometry (measured on the FOX-183 mount). The strip is a closed
// loop around the foot perimeter: pixel 0 starts at the inner ankle directly
// under the controller, runs forward along the medial side to the toe apex,
// back along the lateral side to the heel, then returns to the start. Both
// arcs between toe and heel are 20 steps in the default layout. Prototype
// overrides use their supplied indices. The pure index→fore-aft
// math lives in include/firewalker_strip_map.h (tested in test/test_strip_map).
constexpr uint16_t STRIP_TOE_INDEX  = FIREWALKER_STRIP_TOE_INDEX;
constexpr uint16_t STRIP_HEEL_INDEX = FIREWALKER_STRIP_HEEL_INDEX;
static_assert(LED_COUNT > 0 && STRIP_TOE_INDEX < STRIP_HEEL_INDEX &&
                  STRIP_HEEL_INDEX < LED_COUNT,
              "Strip layout must satisfy toe < heel < pixel count");

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
#ifndef FIREWALKER_LED_BRIGHTNESS
#define FIREWALKER_LED_BRIGHTNESS 100
#endif
// The prototype CLI supplies this for every translation unit, including
// patterns that reapply brightness while rendering. The default is 100.
constexpr uint8_t LED_BRIGHTNESS = FIREWALKER_LED_BRIGHTNESS;  // 0-255

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

constexpr uint8_t IMU_I2C_ADDR = 0x68;   // AD0 low; 0x69 if AD0 tied high

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
// imuTiltFwd() subtracts IMU_MOUNT_FOREAFT_REST_DEG (so a sole-flat foot reads
// level despite the mount's cant), then saturates at ±1 at IMU_TILT_FULL_DEG of
// tilt *from flat* — i.e. the pool fully pours at ~30° toe-down or heel-down.

// ── D6 button ────────────────────────────────────────────────────────────
// Momentary button between Feather silk D6 and GND, internal pull-up. In the
// app it cycles patterns; in imu_debug it's a bench input.
constexpr bool          DEBUG_BUTTON_ENABLED = true;
constexpr uint8_t       DEBUG_BUTTON_PIN = D6;
constexpr unsigned long DEBUG_BUTTON_DEBOUNCE_MS = 30;
constexpr bool          DEBUG_BUTTON_LOG = false;

