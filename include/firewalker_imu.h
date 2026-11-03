#pragma once

#include <Arduino.h>

// Shared motion service used by the app and diagnostics. src/firewalker_imu.cpp
// reads the MG24 Sense's onboard LSM6DS3TR-C and owns:
//   * the raw accel/gyro sample,
//   * a fused fore-aft tilt (complementary filter of accel "down" + gyro rate),
//   * this controller's neutral offset, which sets where tilt reads zero,
//   * stomp detection (acceleration-magnitude spike with hysteresis).
// Thresholds and filter settings live in config.h. The mount's axes live in
// firewalker_mg24_mount.h, shared with the native fast-rotation tests. The pure
// filter/hysteresis math lives in firewalker_fusion.h (tested natively:
// `pio test -e native`). See ADR-0003.

namespace Firewalker {

struct ImuSample {
  float ax, ay, az;  // acceleration, m/s^2 (includes gravity)
  float gx, gy, gz;  // angular rate, rad/s
  float mag;         // |acceleration|, m/s^2
};

// Start the onboard motion sensor and print its status banner. Returns true if it
// is available. When it isn't, imuUpdate() does nothing, tilt reads level, and no
// stomps fire, so patterns still run on a flat baseline.
bool imuBegin();
bool imuReady();

// Poll the IMU at IMU_SAMPLE_MS. On a fresh sample it updates the fused tilt and
// the stomp state. Returns true iff a new sample was processed this call.
bool imuUpdate();

const ImuSample& imuLatest();

// Fused fore-aft tilt relative to the neutral offset, normalized to ~[-1, +1]
// (+ = toe-down), saturating at IMU_TILT_FULL_DEG. Drives the flow pattern.
float imuTiltFwd();

// Fused fore-aft angle in degrees with no neutral offset applied, which is what a
// neutral capture averages.
float imuRawAngleDeg();

// Angular rate magnitude of the latest sample, rad/s. Zero when no motion.
float imuGyroMagnitude();

// The resting angle to treat as level, in degrees. Starts at zero. The caller owns
// saving it; see firewalker_settings.h.
void imuSetNeutralOffsetDeg(float degrees);
float imuNeutralOffsetDeg();

// True exactly once per detected stomp (consume-on-read).
bool imuTakeStomp();

// Strength of the most recent stomp, normalized 0..1 from the trigger threshold
// up to IMU_STOMP_FORCE_FULL. Read alongside imuTakeStomp() to scale visuals by
// how hard the step landed. Persists until the next stomp fires.
float imuStompStrength();

// Throttled (IMU_LOG_MS) verbose serial line: raw accel/gyro, |a|, tilt, armed.
// For imu_debug / bench calibration.
void imuLog();

}  // namespace Firewalker
