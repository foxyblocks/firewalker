#pragma once

#include <Arduino.h>

// Shared IMU (GY-521 / MPU-6050) service: one I2C device read over Wire, used by
// both the app (final_app) and the imu_debug build. It owns three things:
//   * the raw accel/gyro sample,
//   * a fused fore-aft tilt (complementary filter of accel "down" + gyro rate),
//   * stomp detection (acceleration-magnitude spike with hysteresis).
// Knobs live in config.h (IMU_* and FLOW_* axis mapping). See ADR-0003.

namespace Firewalker {

struct ImuSample {
  float ax, ay, az;  // acceleration, m/s^2 (includes gravity)
  float gx, gy, gz;  // angular rate, rad/s
  float mag;         // |acceleration|, m/s^2
};

// Start I2C + the MPU-6050. Prints a status banner. Returns true if found.
bool imuBegin();
bool imuReady();

// Poll the IMU at IMU_SAMPLE_MS. On a fresh sample it updates the fused tilt and
// the stomp state. Returns true iff a new sample was processed this call.
bool imuUpdate();

const ImuSample& imuLatest();

// Fused fore-aft tilt, normalized to ~[-1, +1] (+ = toe-down), saturating at
// FLOW_TILT_FULL_DEG. Drives the flow pattern.
float imuTiltFwd();

// True exactly once per detected stomp (consume-on-read).
bool imuTakeStomp();

// Throttled (IMU_LOG_MS) verbose serial line: raw accel/gyro, |a|, tilt, armed.
// For imu_debug / bench calibration.
void imuLog();

}  // namespace Firewalker
