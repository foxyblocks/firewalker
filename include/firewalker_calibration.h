#pragma once

// Pure tilt calibration: Arduino-free so test/test_calibration can exercise it
// off-hardware. Each controller can save three poses, taken while wearing the boot so
// they capture what that foot really does:
//
//   heel-down pose -> tilt -1      neutral pose -> tilt 0      toe-down pose -> tilt +1
//
// Example: neutral at 4 degrees and toe-down at 34 degrees put full toe tilt at 34, and
// an uncaptured heel side falls back to a default range below neutral. Patterns still
// receive -1 to +1, so they don't know any of this exists.
//
// A pose is captured by PoseCapture below, then checked and applied by applyPose(). A
// rejected pose leaves the existing calibration untouched. Calibration sets where tilt
// lands. It doesn't change the strip's toe and heel positions or the stomp thresholds.

#include <math.h>
#include <stdint.h>

namespace Firewalker {

enum class CalibrationPose : uint8_t { Neutral, Heel, Toe };

// Absolute fused angles in degrees, so retaking neutral doesn't move the other poses.
// A pose that isn't set uses the defaults in TiltLimits.
struct TiltCalibration {
  bool neutralSet = false;
  float neutralDeg = 0.0f;
  bool heelSet = false;
  float heelDeg = 0.0f;
  bool toeSet = false;
  float toeDeg = 0.0f;
};

struct TiltLimits {
  float defaultRangeDeg;  // full tilt, from neutral, on a side with no captured pose
  float deadzoneDeg;      // around neutral, tilt reads exactly 0
  float minSideDeg;       // a heel or toe pose closer than this to neutral is rejected
  float maxNeutralDeg;    // a neutral pose further than this from level is rejected
};

inline float signOf(float value) { return (value < 0.0f) ? -1.0f : 1.0f; }

// Which way of the angle counts as toe-down: +1 or -1. It comes from the captured poses
// when there are any, so a controller mounted backward corrects itself. With neither
// captured, it's the mount's own direction, where a larger angle is toe-down.
inline float toeDirection(const TiltCalibration& calibration) {
  if (calibration.toeSet) return signOf(calibration.toeDeg - calibration.neutralDeg);
  if (calibration.heelSet) return -signOf(calibration.heelDeg - calibration.neutralDeg);
  return 1.0f;
}

// Converts a fused angle into tilt from -1 (heel pose) through 0 (neutral) to +1 (toe
// pose), saturating beyond the poses. The dead zone is in degrees so it covers the same
// angle however short a side is, which lets a calibrated boot rest exactly flat: the
// capture's stillness limit keeps its neutral within that band. Past the dead zone the
// remaining range is rescaled, so tilt still reaches full at the pose itself.
inline float tiltFromAngle(float angleDeg, const TiltCalibration& calibration,
                           const TiltLimits& limits) {
  const float fromNeutral = angleDeg - calibration.neutralDeg;
  const float magnitude = fabsf(fromNeutral);
  if (magnitude <= limits.deadzoneDeg) return 0.0f;

  const bool towardToe = fromNeutral * toeDirection(calibration) >= 0.0f;
  float rangeDeg = limits.defaultRangeDeg;
  if (towardToe && calibration.toeSet) rangeDeg = fabsf(calibration.toeDeg - calibration.neutralDeg);
  if (!towardToe && calibration.heelSet) rangeDeg = fabsf(calibration.heelDeg - calibration.neutralDeg);

  float tilt = 1.0f;
  if (rangeDeg > limits.deadzoneDeg) {
    tilt = (magnitude - limits.deadzoneDeg) / (rangeDeg - limits.deadzoneDeg);
    if (tilt > 1.0f) tilt = 1.0f;
  }
  return towardToe ? tilt : -tilt;
}

// Checks a captured pose and, if it's usable, saves it into `calibration`. Returns
// nullptr on success, or a short reason with `calibration` unchanged:
//   out-of-range  a neutral pose too far from level
//   too-close     a heel or toe pose too close to neutral to give that side a usable range
//   wrong-side    heel and toe on the same side of neutral
//
// Retaking neutral keeps the heel and toe poses, unless the new neutral lands past one of
// them or too close to it. That side then returns to its default range.
inline const char* applyPose(TiltCalibration& calibration, CalibrationPose pose, float angleDeg,
                             const TiltLimits& limits) {
  if (pose == CalibrationPose::Neutral) {
    if (fabsf(angleDeg) > limits.maxNeutralDeg) return "out-of-range";
    const float toeSign = toeDirection(calibration);
    if (calibration.toeSet && (calibration.toeDeg - angleDeg) * toeSign < limits.minSideDeg) {
      calibration.toeSet = false;
      calibration.toeDeg = 0.0f;
    }
    if (calibration.heelSet && (angleDeg - calibration.heelDeg) * toeSign < limits.minSideDeg) {
      calibration.heelSet = false;
      calibration.heelDeg = 0.0f;
    }
    calibration.neutralSet = true;
    calibration.neutralDeg = angleDeg;
    return nullptr;
  }

  const float fromNeutral = angleDeg - calibration.neutralDeg;
  if (fabsf(fromNeutral) < limits.minSideDeg) return "too-close";

  if (pose == CalibrationPose::Heel) {
    if (calibration.toeSet && signOf(fromNeutral) == signOf(calibration.toeDeg - calibration.neutralDeg)) {
      return "wrong-side";
    }
    calibration.heelSet = true;
    calibration.heelDeg = angleDeg;
  } else {
    if (calibration.heelSet && signOf(fromNeutral) == signOf(calibration.heelDeg - calibration.neutralDeg)) {
      return "wrong-side";
    }
    calibration.toeSet = true;
    calibration.toeDeg = angleDeg;
  }
  return nullptr;
}

struct PoseCaptureLimits {
  uint32_t windowMs;    // how long the boot must hold still
  uint32_t noSampleMs;  // a gap this long between samples fails the capture
  uint16_t minSamples;  // samples required by the end of the window
  float maxRangeDeg;    // largest allowed spread of the angle across the window
  float maxGyroRadS;    // any rotation faster than this counts as moving
  float gravity;        // resting acceleration magnitude, m/s^2
  float maxAccelDev;    // acceleration further than this from gravity counts as moving
};

enum class CaptureState : uint8_t {
  Idle,
  Capturing,
  Succeeded,
  FailedMotion,       // the boot moved during the window
  FailedNoSamples,    // the sensor stopped delivering fresh samples
  FailedUnavailable,  // the sensor isn't available at all
};

// Averages the fused angle over a short window while the boot holds still. The result is
// only readable after success, so a failed capture can't replace a good calibration.
class PoseCapture {
 public:
  explicit PoseCapture(const PoseCaptureLimits& limits) : limits_(limits) {}

  // Begins a new capture. An unavailable sensor fails right away.
  void start(uint32_t nowMs, bool sensorReady) {
    if (!sensorReady) {
      state_ = CaptureState::FailedUnavailable;
      return;
    }
    state_ = CaptureState::Capturing;
    startMs_ = nowMs;
    lastSampleMs_ = nowMs;
    count_ = 0;
    sumDeg_ = 0.0f;
    minDeg_ = 0.0f;
    maxDeg_ = 0.0f;
  }

  // Feeds one fresh sensor sample. Ignored unless a capture is running. Finishes the
  // capture as soon as the boot moves or the window completes.
  void addSample(uint32_t nowMs, float angleDeg, float gyroRadS, float accelMagnitude) {
    if (state_ != CaptureState::Capturing) return;
    lastSampleMs_ = nowMs;

    if (gyroRadS > limits_.maxGyroRadS ||
        fabsf(accelMagnitude - limits_.gravity) > limits_.maxAccelDev) {
      state_ = CaptureState::FailedMotion;
      return;
    }
    if (count_ == 0) {
      minDeg_ = angleDeg;
      maxDeg_ = angleDeg;
    }
    if (angleDeg < minDeg_) minDeg_ = angleDeg;
    if (angleDeg > maxDeg_) maxDeg_ = angleDeg;
    if (maxDeg_ - minDeg_ > limits_.maxRangeDeg) {
      state_ = CaptureState::FailedMotion;
      return;
    }
    sumDeg_ += angleDeg;
    count_++;

    if ((int32_t)(nowMs - startMs_) >= (int32_t)limits_.windowMs) {
      if (count_ < limits_.minSamples) {
        state_ = CaptureState::FailedNoSamples;
      } else {
        meanDeg_ = sumDeg_ / (float)count_;
        state_ = CaptureState::Succeeded;
      }
    }
  }

  // Call every loop. Fails the capture if samples stop arriving, since addSample can't
  // notice its own absence.
  void poll(uint32_t nowMs) {
    if (state_ == CaptureState::Capturing &&
        (int32_t)(nowMs - lastSampleMs_) >= (int32_t)limits_.noSampleMs) {
      state_ = CaptureState::FailedNoSamples;
    }
  }

  CaptureState state() const { return state_; }
  bool capturing() const { return state_ == CaptureState::Capturing; }

  // The window's average angle. Only meaningful when state() is Succeeded.
  float meanDeg() const { return meanDeg_; }

 private:
  PoseCaptureLimits limits_;
  CaptureState state_ = CaptureState::Idle;
  uint32_t startMs_ = 0;
  uint32_t lastSampleMs_ = 0;
  uint16_t count_ = 0;
  float sumDeg_ = 0.0f;
  float minDeg_ = 0.0f;
  float maxDeg_ = 0.0f;
  float meanDeg_ = 0.0f;
};

}  // namespace Firewalker
