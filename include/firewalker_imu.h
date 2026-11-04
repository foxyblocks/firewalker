#pragma once

#include <Arduino.h>

#include "firewalker_calibration.h"

// Shared motion service used by the app and diagnostics. src/firewalker_imu.cpp
// reads the MG24 Sense's onboard LSM6DS3TR-C and owns:
//   * the raw accel/gyro sample,
//   * a fused fore-aft tilt (complementary filter of accel "down" + gyro rate),
//   * this controller's calibrated poses, which set where tilt reads -1, 0, and +1,
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

// Fused fore-aft tilt from -1 (heel pose) through 0 (neutral) to +1 (toe pose), mapped by
// the calibration. Reads exactly 0 inside the dead zone. Drives the flow pattern.
float imuTiltFwd();

// Fused fore-aft angle in degrees from the neutral pose, with toe-down positive. It has no
// dead zone and doesn't stop at the poses, so a tolerance in degrees means the same on any
// boot. Reads 0 with no sensor. Drives the fire-trail pattern.
float imuTiltDeg();

// Fused fore-aft angle in degrees before any calibration, which is what a pose capture
// averages.
float imuRawAngleDeg();

// Angular rate magnitude of the latest sample, rad/s. Zero when no motion.
float imuGyroMagnitude();

// The poses tilt is measured against. Starts uncalibrated. The caller owns saving them;
// see firewalker_settings.h.
void imuSetCalibration(const TiltCalibration& calibration);

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
