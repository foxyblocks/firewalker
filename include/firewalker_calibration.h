#pragma once

// Shared pose names, remote report values, and capture states. The live 3D
// capture and mounting geometry are in firewalker_orientation.h. The remote
// protocol uses TiltCalibration only as display metadata; it is not a sensor map.
#include <stdint.h>

namespace Firewalker {
enum class CalibrationPose : uint8_t { Neutral, Heel, Toe };
// Neutral anchors the side poses, so removing it is an explicit reset of all poses.
enum class CalibrationClear : uint8_t { Heel, Toe, All };

// Remote-facing angles derived from the saved 3D mounting reference.
// Neutral is zero; heel/toe are signed degrees relative to that reference.
struct TiltCalibration {
  bool neutralSet = false;
  float neutralDeg = 0.0f;
  bool heelSet = false;
  float heelDeg = 0.0f;
  bool toeSet = false;
  float toeDeg = 0.0f;
};

struct PoseCaptureLimits {
  uint32_t windowMs;    // how long a capture collects the held pose
  uint32_t noSampleMs;  // a gap this long between samples fails the capture
  uint16_t minSamples;  // samples required by the end of the window
  float maxSpreadDeg;   // retained gravity vectors must lie within this angle of their mean
};

enum class CaptureState : uint8_t {
  Idle,
  Capturing,
  Succeeded,
  FailedMotion,       // the boot never settled into one pose
  FailedNoSamples,    // the sensor stopped delivering fresh samples
  FailedUnavailable,  // the sensor isn't available at all
};

// Room for a full window of samples at the sensor's 50 Hz, with some to spare. Samples past
// this are dropped, which only trims the end of the window.
constexpr uint16_t POSE_CAPTURE_MAX_SAMPLES = 128;

// The reason a client sees for a capture that didn't finish.
inline const char* captureFailureReason(CaptureState state) {
  switch (state) {
    case CaptureState::FailedMotion: return "motion";
    case CaptureState::FailedNoSamples: return "no-samples";
    case CaptureState::FailedUnavailable: return "sensor-unavailable";
    default: return "none";
  }
}

enum class CaptureReportKind : uint8_t {
  None,     // nothing new to tell clients
  Started,  // a capture began collecting
  Applied,  // the pose was captured and saved into the calibration
  Failed,   // the capture or its pose was rejected, and the calibration is unchanged
};

struct CaptureReport {
  CaptureReportKind kind = CaptureReportKind::None;
  CalibrationPose pose = CalibrationPose::Neutral;
  float angleDeg = 0.0f;         // for Applied
  const char* reason = nullptr;  // for Failed
};


}  // namespace Firewalker
