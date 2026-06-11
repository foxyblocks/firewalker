#pragma once

#include <math.h>
#include <stdint.h>

// Pure orientation + stomp math for the IMU module — no Arduino, no sensor I/O.
// This is the IMU module's internal seam: firewalker_imu.cpp adapts it to the
// MPU-6050 and the config.h knobs; the native test env (`pio test -e native`)
// exercises the same functions directly, so thresholds, the filter alpha, and
// the hysteresis can be verified off-hardware. See ADR-0003 (why fusion) and
// docs/open-questions.md (bench calibration).

namespace Firewalker {

// Absolute fore-aft tilt angle (radians) from the axis-mapped accelerometer
// components: gravity split between the heel↔toe axis (aFwd) and the
// vertical-at-rest axis (aUp). 0 = level.
inline float accelTiltAngle(float aFwd, float aUp) { return atan2f(aFwd, aUp); }

// One complementary-filter step: integrate the gyro pitch rate short-term,
// pulled toward the accelerometer's absolute angle. `alpha` is the weight on
// the gyro term (≈0.96); dt in seconds. Returns the new fused angle (radians).
inline float fuseTiltStep(float fusedAngle, float accAngle, float gyroRate,
                          float dt, float alpha) {
  return alpha * (fusedAngle + gyroRate * dt) + (1.0f - alpha) * accAngle;
}

// Fused angle (radians) → normalized tilt in [-1, +1], saturating at fullDeg.
inline float normalizeTilt(float angleRad, float fullDeg) {
  float deg = angleRad * 57.2957795f;  // rad -> deg
  float t = deg / fullDeg;
  if (t > 1.0f) t = 1.0f;
  if (t < -1.0f) t = -1.0f;
  return t;
}

// Stomp detection: acceleration-magnitude hysteresis + a refractory gap, so one
// physical impact = one trigger (see CONTEXT.md, Hysteresis). The caller owns
// the state and consumes `pending`.
struct StompState {
  bool     armed       = true;
  bool     pending     = false;  // set on fire; caller clears when consumed
  uint32_t lastStompMs = 0;
  float    fireMag     = 0.0f;   // |accel| at the trigger sample (stomp "force")
};

struct StompParams {
  float    fireAbove;     // fire when |a| rises to this, if armed
  float    rearmBelow;    // re-arm once |a| falls back to this
  uint32_t refractoryMs;  // minimum gap between fires
};

inline void stompStep(StompState& s, float mag, uint32_t nowMs,
                      const StompParams& p) {
  if (s.armed && mag >= p.fireAbove && (nowMs - s.lastStompMs) >= p.refractoryMs) {
    s.armed = false;
    s.pending = true;
    s.lastStompMs = nowMs;
    s.fireMag = mag;  // remember how hard it hit, for force-scaled visuals
  } else if (!s.armed && mag <= p.rearmBelow) {
    s.armed = true;
  }
}

}  // namespace Firewalker
