#pragma once

#include <stdint.h>

/**
 * Maps the MG24 Sense's sensor coordinates into the shoe's fore-aft tilt plane.
 * firewalker_imu.cpp converts sensor readings to m/s² and rad/s before using
 * these helpers; firewalker_fusion.h then combines the mapped acceleration and
 * gyro. The native motion tests use the same mapping to replay physical rotations,
 * so a sign mismatch cannot be hidden by a filter that eventually settles.
 *
 * Both shoes share this mapping, because they mount the controller in the same
 * orientation: accel X is fore-aft, accel Z is up, and rotation around Y changes
 * pitch. Each controller's neutral offset is captured and saved separately (see
 * firewalker_neutral.h); it changes the resting angle and cannot repair an
 * incorrect axis or gyro sign.
 */
namespace Firewalker {
namespace Mg24Mount {

constexpr uint8_t FOREAFT_AXIS = 0;
constexpr float FOREAFT_SIGN = +1.0f;
constexpr uint8_t VERTICAL_AXIS = 2;
constexpr float VERTICAL_SIGN = +1.0f;
constexpr uint8_t PITCH_GYRO_AXIS = 1;
// With fore-aft = +X and up = +Z, atan2(accel X, accel Z) decreases during
// positive rotation about sensor Y. Negate gyro Y so its immediate prediction
// follows that same angle instead of fighting the accelerometer correction.
constexpr float PITCH_GYRO_SIGN = -1.0f;
constexpr float FOREAFT_REST_DEG = 0.0f;

inline float signedAxis(float x, float y, float z, uint8_t axis, float sign) {
  return ((axis == 0) ? x : (axis == 1) ? y : z) * sign;
}

inline float foreAftAcceleration(float ax, float ay, float az) {
  return signedAxis(ax, ay, az, FOREAFT_AXIS, FOREAFT_SIGN);
}

inline float verticalAcceleration(float ax, float ay, float az) {
  return signedAxis(ax, ay, az, VERTICAL_AXIS, VERTICAL_SIGN);
}

// Returns the angular rate in the direction used by atan2(fore-aft, up).
// It must agree with how the acceleration-derived angle changes during pitch.
inline float pitchAngularRate(float gx, float gy, float gz) {
  return signedAxis(gx, gy, gz, PITCH_GYRO_AXIS, PITCH_GYRO_SIGN);
}

}  // namespace Mg24Mount
}  // namespace Firewalker
