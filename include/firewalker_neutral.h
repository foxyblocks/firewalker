#pragma once

// Pure neutral-calibration capture: Arduino-free so test/test_neutral can exercise
// it off-hardware. The user holds the boot in its resting position and asks for a
// capture. The app feeds in fused-angle samples for a short window, and a capture
// that stays still produces the average angle, which becomes this controller's
// zero. Any failure leaves the caller's existing offset untouched, because the
// result is only readable after success.
//
// Example: a boot resting 4 degrees toe-down reads an offset of about +4.0. After
// the app subtracts it, the same pose reads tilt near 0 and the flow pattern rests
// flat. The capture doesn't change which way counts as toe-down, the strip's toe
// and heel positions, or the stomp thresholds.

#include <math.h>
#include <stdint.h>

namespace Firewalker {

struct NeutralLimits {
  uint32_t windowMs;      // how long the boot must hold still
  uint32_t noSampleMs;    // a gap this long between samples fails the capture
  uint16_t minSamples;    // samples required by the end of the window
  float maxRangeDeg;      // largest allowed spread of the angle across the window
  float maxGyroRadS;      // any rotation faster than this counts as moving
  float gravity;          // resting acceleration magnitude, m/s^2
  float maxAccelDev;      // acceleration further than this from gravity counts as moving
  float maxOffsetDeg;     // reject a resting angle beyond this, as not near level
};

enum class NeutralState : uint8_t {
  Idle,
  Capturing,
  Succeeded,
  FailedMotion,       // the boot moved during the window
  FailedNoSamples,    // the sensor stopped delivering fresh samples
  FailedUnavailable,  // the sensor isn't available at all
  FailedOutOfRange,   // held still, but too far from level to be a neutral pose
};

class NeutralCapture {
 public:
  explicit NeutralCapture(const NeutralLimits& limits) : limits_(limits) {}

  // Begins a new capture. An unavailable sensor fails right away.
  void start(uint32_t nowMs, bool sensorReady) {
    if (!sensorReady) {
      state_ = NeutralState::FailedUnavailable;
      return;
    }
    state_ = NeutralState::Capturing;
    startMs_ = nowMs;
    lastSampleMs_ = nowMs;
    count_ = 0;
    sumDeg_ = 0.0f;
    minDeg_ = 0.0f;
    maxDeg_ = 0.0f;
  }

  // Feeds one fresh sensor sample. Ignored unless a capture is running. Finishes
  // the capture as soon as it moves or the window completes.
  void addSample(uint32_t nowMs, float angleDeg, float gyroRadS, float accelMagnitude) {
    if (state_ != NeutralState::Capturing) return;
    lastSampleMs_ = nowMs;

    if (gyroRadS > limits_.maxGyroRadS ||
        fabsf(accelMagnitude - limits_.gravity) > limits_.maxAccelDev) {
      state_ = NeutralState::FailedMotion;
      return;
    }
    if (count_ == 0) {
      minDeg_ = angleDeg;
      maxDeg_ = angleDeg;
    }
    if (angleDeg < minDeg_) minDeg_ = angleDeg;
    if (angleDeg > maxDeg_) maxDeg_ = angleDeg;
    if (maxDeg_ - minDeg_ > limits_.maxRangeDeg) {
      state_ = NeutralState::FailedMotion;
      return;
    }
    sumDeg_ += angleDeg;
    count_++;

    if (nowMs - startMs_ >= limits_.windowMs) finish();
  }

  // Call every loop. Fails the capture if samples stop arriving, since addSample
  // can't notice its own absence.
  void poll(uint32_t nowMs) {
    if (state_ == NeutralState::Capturing && nowMs - lastSampleMs_ >= limits_.noSampleMs) {
      state_ = NeutralState::FailedNoSamples;
    }
  }

  NeutralState state() const { return state_; }
  bool capturing() const { return state_ == NeutralState::Capturing; }

  // The captured offset. Only meaningful when state() is Succeeded.
  float offsetDeg() const { return offsetDeg_; }

 private:
  void finish() {
    if (count_ < limits_.minSamples) {
      state_ = NeutralState::FailedNoSamples;
      return;
    }
    const float mean = sumDeg_ / (float)count_;
    if (fabsf(mean) > limits_.maxOffsetDeg) {
      state_ = NeutralState::FailedOutOfRange;
      return;
    }
    offsetDeg_ = mean;
    state_ = NeutralState::Succeeded;
  }

  NeutralLimits limits_;
  NeutralState state_ = NeutralState::Idle;
  uint32_t startMs_ = 0;
  uint32_t lastSampleMs_ = 0;
  uint16_t count_ = 0;
  float sumDeg_ = 0.0f;
  float minDeg_ = 0.0f;
  float maxDeg_ = 0.0f;
  float offsetDeg_ = 0.0f;
};

}  // namespace Firewalker
