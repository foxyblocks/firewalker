// final_app is the shoe app, and the same binary runs on both shoes. The onboard
// sensor drives the active pattern, the remote (BLE or the USB console) changes
// settings, and each controller keeps its own pattern, brightness, and calibrated
// poses in flash. Losing the phone never matters: whatever is running keeps
// running, and a reconnecting client is told the current state.
//
// Each loop pass reads the sensor, handles any remote commands, saves settings that
// are due, and renders at most one frame. See docs/remote-protocol.md for commands.

#include "modes/final_app.h"

#include <Arduino.h>

#include "config.h"
#include "firewalker_core.h"
#include "firewalker_calibration.h"
#include "firewalker_imu.h"
#include "firewalker_remote.h"
#include "firewalker_remote_protocol.h"
#include "firewalker_settings.h"
#include "firewalker_settings_store.h"
#include "patterns/fire_trail.h"
#include "patterns/flow.h"
#include "patterns/pattern.h"

namespace FinalAppMode {

using namespace Firewalker;

static constexpr SettingsBounds SETTINGS_BOUNDS = {LED_BRIGHTNESS_MIN, LED_BRIGHTNESS_MAX,
                                                   TILT_LIMITS.maxNeutralDeg};
static constexpr PoseCaptureLimits CAPTURE_LIMITS = {
    CALIBRATION_WINDOW_MS, CALIBRATION_NO_SAMPLE_MS, CALIBRATION_MIN_SAMPLES,
    CALIBRATION_MAX_SPREAD_DEG};

static FlowPattern flow;
static FireTrailPattern fireTrail;
static Pattern* activePattern = nullptr;  // null when the strip is off

static Settings settings = defaultSettings(LED_BRIGHTNESS);
static SaveScheduler saveScheduler(SETTINGS_SAVE_QUIET_MS, SETTINGS_SAVE_MAX_MS);
static bool saveFailed = false;

static PoseCapture poseCapture(CAPTURE_LIMITS);
static CalibrationPose capturedPose = CalibrationPose::Neutral;
static CaptureState reportedCaptureState = CaptureState::Idle;
static const char* calibrationState = "idle";  // what status reports for the latest capture

static bool identifying = false;
static unsigned long identifyStartMs = 0;

static bool debugEnabled = false;
static bool statusPending = false;
static bool stompPending = false;         // fired since the last frame
static bool stompSinceReport = false;     // fired since the last motion line
static float accelPeak = 0.0f;            // highest acceleration since the last motion line
static unsigned long lastFrameMs = 0;
static unsigned long lastPatternUpdateMs = 0;
static unsigned long lastStatusMs = 0;
static unsigned long lastMotionMs = 0;

static void sendStatus() {
  StatusReport report{};
  report.id = remoteDeviceId();
  report.pattern = settings.pattern;
  report.lit = settings.lastLitPattern;
  report.brightness = settings.brightness;
  report.maxBrightness = LED_BRIGHTNESS_MAX;
  report.sensorReady = imuReady();
  report.tilt = imuTiltFwd();
  report.calibration = settings.calibration;
  report.calibrationState = calibrationState;
  report.saved = !saveScheduler.dirty() && !saveFailed;
  report.saveFailed = saveFailed;
  report.saves = settingsWriteCount();
  report.debug = debugEnabled;
  report.bleConnected = remoteBleConnected();

  char line[REMOTE_LINE_MAX];
  formatStatus(line, sizeof(line), report);
  remoteSend(line);
  lastStatusMs = millis();
  statusPending = false;
}

static void sendAck(CommandType type, bool ok, const char* error = nullptr) {
  char line[REMOTE_LINE_MAX];
  formatAck(line, sizeof(line), type, ok, error);
  remoteSend(line);
}

static void saveNow() {
  saveFailed = !saveSettings(settings);
  saveScheduler.markSaved();
  statusPending = true;
}

// Makes `pattern` the one on the strip. Motion processing carries on either way, so
// turning the strip back on picks up the current tilt straight away.
static void showPattern(PatternId pattern) {
  switch (pattern) {
    case PatternId::Flow: activePattern = &flow; break;
    case PatternId::FireTrail: activePattern = &fireTrail; break;
    case PatternId::Off: activePattern = nullptr; break;
  }
  if (activePattern) {
    activePattern->enter();
  } else {
    strip.clear();
    strip.show();
  }
  stompPending = false;
  lastPatternUpdateMs = millis();
}

static void selectPattern(PatternId pattern) {
  if (pattern != PatternId::Off) settings.lastLitPattern = pattern;
  if (pattern != settings.pattern) {
    settings.pattern = pattern;
    showPattern(pattern);
  }
  saveScheduler.markChanged(millis());
}

static void handleCommand(const Command& command) {
  switch (command.type) {
    case CommandType::Invalid:
      sendAck(CommandType::Invalid, false, command.error);
      return;

    case CommandType::Status:
      sendStatus();
      return;

    case CommandType::Patterns: {
      char line[REMOTE_LINE_MAX];
      formatPatterns(line, sizeof(line));
      remoteSend(line);
      return;
    }

    // Blinks the strip so you can see which boot this is. It changes no settings, so
    // there's nothing new to report and nothing to save.
    case CommandType::Identify:
      identifying = true;
      identifyStartMs = millis();
      sendAck(command.type, true);
      return;

    case CommandType::Pattern:
      selectPattern(command.pattern);
      sendAck(command.type, true);
      break;

    case CommandType::Power:
      selectPattern(command.on ? settings.lastLitPattern : PatternId::Off);
      sendAck(command.type, true);
      break;

    case CommandType::Brightness:
      if (command.value < LED_BRIGHTNESS_MIN || command.value > LED_BRIGHTNESS_MAX) {
        sendAck(command.type, false, "out-of-range");
        return;
      }
      settings.brightness = (uint8_t)command.value;
      strip.setBrightness(settings.brightness);
      saveScheduler.markChanged(millis());
      sendAck(command.type, true);
      break;

    case CommandType::Calibrate:
      if (poseCapture.capturing()) {
        sendAck(command.type, false, "already-capturing");
        return;
      }
      capturedPose = command.pose;
      // Forget the last reported state, so a capture that fails the same way as the
      // previous one still sends its own calibrate line.
      reportedCaptureState = CaptureState::Idle;
      poseCapture.start(millis(), imuReady());
      // The status line this command triggers can go out later in this same loop pass,
      // before updatePoseCapture runs again, and it must not report the previous capture's
      // result as if it were this one's.
      calibrationState = poseCapture.capturing() ? "capturing" : captureFailureReason(poseCapture.state());
      sendAck(command.type, poseCapture.capturing(), captureFailureReason(poseCapture.state()));
      break;

    case CommandType::Debug:
      debugEnabled = command.on;
      sendAck(command.type, true);
      break;
  }
  statusPending = true;
}

// Reports a capture's progress once per state change. A pose that settles and passes its
// checks is applied and saved right away, because a calibration is worth more than the
// wear of one write. Any failure leaves the previous calibration alone, in use and in flash.
static void updatePoseCapture() {
  poseCapture.poll(millis());
  const CaptureState state = poseCapture.state();
  if (state == reportedCaptureState) return;
  reportedCaptureState = state;

  char line[REMOTE_LINE_MAX];
  if (state == CaptureState::Capturing) {
    calibrationState = "capturing";
    formatCalibrationCapturing(line, sizeof(line), capturedPose);
  } else {
    const float angleDeg = poseCapture.angleDeg();
    const char* failure = (state == CaptureState::Succeeded)
                              ? applyPose(settings.calibration, capturedPose, angleDeg, TILT_LIMITS)
                              : captureFailureReason(state);
    if (failure) {
      calibrationState = failure;
      formatCalibrationFailed(line, sizeof(line), capturedPose, failure);
    } else {
      calibrationState = "ok";
      imuSetCalibration(settings.calibration);
      saveNow();
      formatCalibrationOk(line, sizeof(line), capturedPose, angleDeg, imuTiltFwd());
    }
  }
  remoteSend(line);
  statusPending = true;
}

// Lines stay under the motion rate limit, and they drop first if BLE falls behind.
static void sendMotionIfDue(unsigned long now) {
  if (!debugEnabled || (now - lastMotionMs) < REMOTE_MOTION_REPORT_MS) return;
  lastMotionMs = now;

  char line[REMOTE_LINE_MAX];
  formatMotion(line, sizeof(line), imuTiltFwd(), imuRawAngleDeg(), imuLatest().mag, accelPeak,
               imuGyroMagnitude(), stompSinceReport, imuStompStrength());
  remoteSend(line, RemotePriority::Telemetry);
  stompSinceReport = false;
  accelPeak = 0.0f;
}

// Draws one frame, at most every APP_FRAME_MS so the strip can't take all of the
// loop's time from the sensor and the radio. With the strip off, a black frame now
// and then keeps it dark if the strip's power was cycled separately.
static void renderIfDue(unsigned long now) {
  // An identify blink takes over the strip briefly, then the pattern starts back up.
  if (identifying) {
    stompPending = false;
    const unsigned long elapsed = now - identifyStartMs;
    if (elapsed >= IDENTIFY_MS) {
      identifying = false;
      showPattern(settings.pattern);
    } else if ((now - lastFrameMs) >= APP_FRAME_MS) {
      lastFrameMs = now;
      const uint32_t color = ((elapsed / IDENTIFY_BLINK_MS) % 2 == 0) ? 0xFFFFFF : 0x000000;
      for (uint16_t i = 0; i < LED_COUNT; i++) strip.setPixelColor(i, color);
      strip.show();
    }
    return;
  }

  if (!activePattern) {
    if ((now - lastFrameMs) >= APP_OFF_REFRESH_MS) {
      lastFrameMs = now;
      strip.clear();
      strip.show();
    }
    stompPending = false;
    return;
  }
  if ((now - lastFrameMs) < APP_FRAME_MS) return;
  lastFrameMs = now;

  PatternInput input;
  input.tiltFwd = imuTiltFwd();
  input.stomp = stompPending;
  input.stompStrength = imuStompStrength();
  input.dt = now - lastPatternUpdateMs;
  lastPatternUpdateMs = now;
  stompPending = false;
  activePattern->update(input);
}

void setup() {
  setupCore(F("final_app"));

  const char* loaded = loadSettings(SETTINGS_BOUNDS, settings);
  Serial.print(F("[firewalker] settings: "));
  Serial.println(loaded);

  imuBegin();
  imuSetCalibration(settings.calibration);

  remoteBegin();
  strip.setBrightness(settings.brightness);
  showPattern(settings.pattern);
  sendStatus();
}

void loop() {
  if (imuUpdate()) {
    if (imuTakeStomp()) {
      stompPending = true;
      stompSinceReport = true;
    }
    if (imuLatest().mag > accelPeak) accelPeak = imuLatest().mag;
    poseCapture.addSample(millis(), imuRawAngleDeg());
  }
  updatePoseCapture();

  char line[REMOTE_COMMAND_MAX + 1];
  while (remoteNextLine(line, sizeof(line))) {
    handleCommand(parseCommand(line));
  }

  // Read the clock after handling commands, which stamp their changes with millis().
  // An earlier reading would make those stamps look like they're in the future, and
  // the elapsed times below would wrap around to huge values.
  const unsigned long now = millis();

  if (saveScheduler.due(now)) saveNow();

  if (remoteTakeClientReady()) statusPending = true;
  if (statusPending && (now - lastStatusMs) >= REMOTE_STATUS_MIN_MS) sendStatus();
  sendMotionIfDue(now);

  renderIfDue(now);

  updateStatusLight((poseCapture.capturing() || identifying) ? StatusLight::Calibrating
                    : imuReady()                             ? StatusLight::Running
                                                             : StatusLight::SensorMissing);
  remoteUpdate();
}

}  // namespace FinalAppMode
