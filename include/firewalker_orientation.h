#pragma once

// Mounted-boot orientation: the chip may sit at any fixed 3D angle on the shoe.
// GravityFusion tracks gravity in chip coordinates using all accelerometer/gyro
// axes. Neutral plus a held heel/toe pose teaches the boot's fore-aft plane in
// those coordinates. Only the final projection becomes the -1..+1 pattern input.
// This module is pure; the IMU service supplies samples and final_app saves poses.
#include <math.h>
#include "firewalker_calibration.h"

namespace Firewalker {
struct Vec3 {
  float x = 0, y = 0, z = 0;
  Vec3 operator+(Vec3 b) const { return {x+b.x, y+b.y, z+b.z}; }
  Vec3 operator-(Vec3 b) const { return {x-b.x, y-b.y, z-b.z}; }
  Vec3 operator*(float s) const { return {x*s, y*s, z*s}; }
};
inline float dot(Vec3 a, Vec3 b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
inline Vec3 cross(Vec3 a, Vec3 b) { return {a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x}; }
inline bool usableVector(Vec3 a) { return isfinite(a.x) && isfinite(a.y) && isfinite(a.z) && dot(a,a) > 1e-8f; }
inline Vec3 unit(Vec3 a) { return usableVector(a) ? a * (1.0f / sqrtf(dot(a,a))) : Vec3{}; }
inline float vectorAngleDeg(Vec3 a, Vec3 b) { return acosf(fminf(1, fmaxf(-1, dot(unit(a),unit(b))))) * 57.2957795f; }

// Integrates all three gyro axes in chip coordinates. Gravity is stationary in
// the world, so it turns opposite to the chip. Accelerometer correction is used
// only near the gravity magnitude; a stomp must not become a new resting angle.
class GravityFusion {
 public:
  // Acceleration is m/s², gyro is rad/s, and dt is seconds. The first trusted
  // acceleration seeds the estimate, so booting at any mounting angle is immediate.
  // Subsequent samples use gyro prediction plus a small gravity correction.
  void update(Vec3 acceleration, Vec3 gyro, float dt, float alpha,
              float gravityMagnitude, float maxGravityError) {
    const float magnitude = sqrtf(dot(acceleration, acceleration));
    const bool trusted = usableVector(acceleration) && fabsf(magnitude-gravityMagnitude) <= maxGravityError;
    if (!seeded_) {
      if (trusted) { gravity_ = unit(acceleration); seeded_ = true; }
      return;
    }
    Vec3 predicted = gravity_;
    if (usableVector(gyro) && isfinite(dt) && dt > 0) {
      const float speed = sqrtf(dot(gyro,gyro));
      const Vec3 axis = gyro * (1.0f/speed);
      const float angle = -speed*dt;
      predicted = gravity_*cosf(angle) + cross(axis,gravity_)*sinf(angle)
                  + axis*(dot(axis,gravity_)*(1-cosf(angle)));
    }
    gravity_ = unit(trusted ? predicted*alpha + unit(acceleration)*(1-alpha) : predicted);
  }
  Vec3 gravity() const { return gravity_; }
 private:
  Vec3 gravity_;
  bool seeded_ = false;
};

struct OrientationLimits {
  float defaultRangeDeg;  // full tilt on the uncaptured side
  float deadzoneDeg;      // small movement around neutral stays visually flat
  float minSideDeg;       // a side must be far enough from neutral to learn an axis
  float maxAxisErrorDeg;  // tolerance between the two measured fore-aft planes
};
// Unit gravity vectors in chip coordinates, saved on the physical controller.
struct OrientationCalibration {
  bool neutralSet = false, heelSet = false, toeSet = false;
  Vec3 neutral, heel, toe;
};

// Project a held side onto the plane perpendicular to neutral gravity. That
// tangent tells us which combination of the chip's axes is along the foot.
inline Vec3 poseTangent(Vec3 pose, Vec3 neutral) { return unit(pose - neutral * dot(pose, neutral)); }
inline bool orientationCalibrated(const OrientationCalibration& c) {
  return c.neutralSet && (c.heelSet || c.toeSet);
}
// Each side contributes a direction independent of how far it can tilt. Averaging
// both directions keeps a deeper toe pose from overwhelming the heel observation.
inline Vec3 bootForward(const OrientationCalibration& c) {
  Vec3 forward;
  if (c.toeSet) forward = forward + poseTangent(c.toe, c.neutral);
  if (c.heelSet) forward = forward - poseTangent(c.heel, c.neutral);
  return unit(forward);
}
// Signed pitch in the learned fore-aft plane. Until a side teaches that plane,
// patterns rest at neutral rather than guessing a chip axis as the foot's axis.
inline float orientationDegrees(Vec3 gravity, const OrientationCalibration& c) {
  if (!orientationCalibrated(c) || !usableVector(gravity)) return 0;
  const float forward = dot(gravity, bootForward(c));
  const float up = dot(gravity, c.neutral);
  if (forward*forward + up*up < 1e-8f) return 0;
  return atan2f(forward, up) * 57.2957795f;
}
// Rescale each learned side separately to -1..+1 after removing the neutral dead
// zone. Patterns receive the same range even when one foot has less travel.
inline float orientationTilt(Vec3 gravity, const OrientationCalibration& c, const OrientationLimits& limits) {
  const float angle = orientationDegrees(gravity, c);
  const float magnitude = fabsf(angle);
  if (magnitude <= limits.deadzoneDeg) return 0;
  const bool toe = angle >= 0;
  const float range = toe && c.toeSet ? fabsf(orientationDegrees(c.toe,c))
                    : !toe && c.heelSet ? fabsf(orientationDegrees(c.heel,c)) : limits.defaultRangeDeg;
  const float amount = range > limits.deadzoneDeg ? fminf(1, (magnitude-limits.deadzoneDeg)/(range-limits.deadzoneDeg)) : 1;
  return toe ? amount : -amount;
}

// A new neutral starts a new mounting reference, so its old side poses are reset.
// Side poses must be distinct from neutral and agree on one fore-aft plane. A
// rejection leaves all saved poses intact; the remote can explicitly clear a side.
inline const char* applyOrientationPose(OrientationCalibration& c, CalibrationPose pose, Vec3 gravity,
                                        const OrientationLimits& limits) {
  if (!usableVector(gravity)) return "no-samples";
  gravity = unit(gravity);
  if (pose == CalibrationPose::Neutral) {
    c = OrientationCalibration{};
    c.neutralSet = true;
    c.neutral = gravity;
    return nullptr;
  }
  if (!c.neutralSet) return "neutral-required";
  const float separation = vectorAngleDeg(c.neutral, gravity);
  if (separation < limits.minSideDeg) return "too-close";
  if (separation > 180.0f - limits.minSideDeg) return "off-axis";
  const bool otherSet = pose == CalibrationPose::Heel ? c.toeSet : c.heelSet;
  if (otherSet) {
    const Vec3 other = pose == CalibrationPose::Heel ? c.toe : c.heel;
    const float agreement = dot(poseTangent(gravity,c.neutral),poseTangent(other,c.neutral));
    if (agreement >= 0) return "wrong-side";
    if (agreement > -cosf(limits.maxAxisErrorDeg * 0.0174532925f)) return "off-axis";
  }
  if (pose == CalibrationPose::Heel) { c.heelSet = true; c.heel = gravity; }
  else { c.toeSet = true; c.toe = gravity; }
  return nullptr;
}

// Reports the learned poses through the existing remote angle fields. These are
// boot-relative degrees; stored 3D vectors, not these display values, drive motion.
inline TiltCalibration orientationReport(const OrientationCalibration& c) {
  TiltCalibration report;
  report.neutralSet = c.neutralSet;
  report.heelSet = c.heelSet;
  report.toeSet = c.toeSet;
  report.heelDeg = c.heelSet ? orientationDegrees(c.heel,c) : 0;
  report.toeDeg = c.toeSet ? orientationDegrees(c.toe,c) : 0;
  return report;
}
// Flash validation checks the stored mounting geometry before patterns use it.
inline bool validOrientationCalibration(const OrientationCalibration& c) {
  if ((c.heelSet || c.toeSet) && !c.neutralSet) return false;
  const auto isUnit = [](Vec3 v) { return usableVector(v) && fabsf(dot(v,v)-1) < .01f; };
  if (c.neutralSet && !isUnit(c.neutral)) return false;
  if (c.heelSet && (!isUnit(c.heel) || !usableVector(poseTangent(c.heel,c.neutral)))) return false;
  if (c.toeSet && (!isUnit(c.toe) || !usableVector(poseTangent(c.toe,c.neutral)))) return false;
  if (c.heelSet && c.toeSet && dot(poseTangent(c.heel,c.neutral),poseTangent(c.toe,c.neutral)) >= 0) return false;
  return true;
}

// Captures held gravity vectors without choosing a sensor axis. Samples closest
// to the whole-window center supply the mean; the furthest quarter is discarded
// to tolerate a stumble. The retained three quarters must fit inside the angular
// spread limit, so equal-time rocking between heel and toe cannot pass as a hold.
class OrientationCalibrator {
 public:
  OrientationCalibrator(PoseCaptureLimits capture, OrientationLimits tilt) : limits_(capture), tilt_(tilt) {}
  // Begin one held pose; an active capture keeps its place if another is requested.
  const char* start(CalibrationPose pose, uint32_t now, bool ready) {
    if (capturing()) return "already-capturing";
    pose_ = pose; start_ = last_ = now; count_ = 0; reported_ = CaptureState::Idle;
    state_ = ready ? CaptureState::Capturing : CaptureState::FailedUnavailable;
    status_ = ready ? "capturing" : "sensor-unavailable";
    return ready ? nullptr : status_;
  }
  // Feed only fresh IMU readings. Unusable vectors do not keep a dead sensor alive.
  void addSample(uint32_t now, Vec3 gravity) {
    if (!capturing() || !usableVector(gravity)) return;
    last_ = now;
    if (count_ < POSE_CAPTURE_MAX_SAMPLES) samples_[count_++] = unit(gravity);
    if (now-start_ >= limits_.windowMs) finish();
  }
  // Poll every loop. Reports each transition once and commits a valid held pose
  // to the in-memory calibration; the caller owns applying and saving that change.
  CaptureReport update(uint32_t now, OrientationCalibration& calibration) {
    if (capturing() && now-last_ >= limits_.noSampleMs) state_ = CaptureState::FailedNoSamples;
    CaptureReport report;
    if (state_ == reported_) return report;
    reported_ = state_; report.pose = pose_;
    if (capturing()) { report.kind = CaptureReportKind::Started; return report; }
    const char* error = state_ == CaptureState::Succeeded
      ? applyOrientationPose(calibration,pose_,result_,tilt_) : captureFailureReason(state_);
    if (error) { report.kind = CaptureReportKind::Failed; report.reason = status_ = error; }
    else { report.kind = CaptureReportKind::Applied; report.angleDeg = orientationDegrees(result_,calibration); status_ = "ok"; }
    return report;
  }
  // A clear cannot race a held capture and be undone by that capture's result.
  const char* clear(CalibrationClear target, OrientationCalibration& c) {
    if (capturing()) return "already-capturing";
    if (target == CalibrationClear::All) c = OrientationCalibration{};
    else if (target == CalibrationClear::Heel) { c.heelSet=false; c.heel={}; }
    else { c.toeSet=false; c.toe={}; }
    reported_ = state_; status_ = "idle";
    return nullptr;
  }
  bool capturing() const { return state_ == CaptureState::Capturing; }
  const char* statusText() const { return status_; }
 private:
  void finish() {
    if (count_ < limits_.minSamples) { state_=CaptureState::FailedNoSamples; return; }
    Vec3 sum;
    for (uint16_t i=0; i<count_; i++) sum=sum+samples_[i];
    if (!usableVector(sum)) { state_=CaptureState::FailedMotion; return; }
    const Vec3 center=unit(sum);
    // Sort nearest first by dot product. No coordinate-specific sorting means a
    // tilted mounting produces exactly the same capture decision as a flat one.
    for (uint16_t i=1; i<count_; i++) {
      const Vec3 sample=samples_[i]; uint16_t j=i;
      while (j>0 && dot(samples_[j-1],center)<dot(sample,center)) { samples_[j]=samples_[j-1]; j--; }
      samples_[j]=sample;
    }
    const uint16_t kept=count_-count_/4;
    sum={}; for (uint16_t i=0; i<kept; i++) sum=sum+samples_[i];
    result_=unit(sum);
    const float minDot=cosf(limits_.maxSpreadDeg*0.0174532925f);
    for (uint16_t i=0; i<kept; i++) {
      if (dot(result_,samples_[i])<minDot) { state_=CaptureState::FailedMotion; return; }
    }
    state_=CaptureState::Succeeded;
  }
  PoseCaptureLimits limits_;
  OrientationLimits tilt_;
  Vec3 samples_[POSE_CAPTURE_MAX_SAMPLES];
  Vec3 result_;
  uint16_t count_=0;
  uint32_t start_=0, last_=0;
  CalibrationPose pose_=CalibrationPose::Neutral;
  CaptureState state_=CaptureState::Idle, reported_=CaptureState::Idle;
  const char* status_="idle";
};

}  // namespace Firewalker
