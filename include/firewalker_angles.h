#pragma once

#include <math.h>

// Scalar angle validation for stored report fields and older settings records.
// Runtime motion uses learned 3D vectors in firewalker_orientation.h. Older
// records can still put neighboring poses on opposite sides of -180/+180.
namespace Firewalker {

// Canonical sensor representation. The +/-180 endpoints are both valid; values
// outside one turn and non-finite values indicate unusable data, not a steep mount.
inline bool validAngleDegrees(float angle) {
  return isfinite(angle) && fabsf(angle) <= 180.0f;
}

inline float wrapDegrees(float angle) {
  angle = fmodf(angle, 360.0f);
  if (angle > 180.0f) angle -= 360.0f;
  if (angle < -180.0f) angle += 360.0f;
  return angle;
}

// Signed shortest movement from reference to angle, in -180..+180 degrees.
inline float degreesBetween(float angle, float reference) {
  return wrapDegrees(angle - reference);
}

}  // namespace Firewalker
