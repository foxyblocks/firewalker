// final_app is the shoe app, and the same binary runs on both shoes. The onboard
// sensor drives the active pattern, the remote (BLE or the USB console) changes
// settings, and each controller keeps its own pattern, brightness, and neutral
// calibration in flash. Losing the phone never matters: whatever is running keeps
// running, and a reconnecting client is told the current state.
//
// Each loop pass reads the sensor, handles any remote commands, saves settings that
// are due, and renders at most one frame. See docs/remote-protocol.md for commands.

#include "modes/final_app.h"

#include <Arduino.h>

#include "config.h"
#include "firewalker_core.h"
#include "firewalker_imu.h"
#include "firewalker_neutral.h"
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
                                                   NEUTRAL_MAX_OFFSET_DEG};
static constexpr NeutralLimits NEUTRAL_LIMITS = {
    NEUTRAL_WINDOW_MS,     NEUTRAL_NO_SAMPLE_MS,  NEUTRAL_MIN_SAMPLES,
    NEUTRAL_MAX_RANGE_DEG, NEUTRAL_MAX_GYRO_RADS, IMU_GRAVITY,
    NEUTRAL_MAX_ACCEL_DEV, NEUTRAL_MAX_OFFSET_DEG};

static FlowPattern flow;
static FireTrailPattern fireTrail;
static Pattern* activePattern = nullptr;  // null when the strip is off

static Settings settings = defaultSettings(LED_BRIGHTNESS);
static SaveScheduler saveScheduler(SETTINGS_SAVE_QUIET_MS, SETTINGS_SAVE_MAX_MS);
static bool saveFailed = false;

static NeutralCapture neutralCapture(NEUTRAL_LIMITS);
static NeutralState reportedNeutralState = NeutralState::Idle;

static bool debugEnabled = false;
static bool statusPending = false;
static bool stompPending = false;         // fired since the last frame
static bool stompSinceReport = false;     // fired since the last motion line
static unsigned long lastFrameMs = 0;
static unsigned long lastPatternUpdateMs = 0;
static unsigned long lastStatusMs = 0;
static unsigned long lastMotionMs = 0;

static const char* calibrationText() {
  switch (neutralCapture.state()) {
    case NeutralState::Idle: return "idle";
    case NeutralState::Capturing: return "capturing";
    case NeutralState::Succeeded: return "ok";
    default: return neutralFailureReason(neutralCapture.state());
  }
}

static void sendStatus() {
  StatusReport report{};
  report.id = remoteDeviceId();
  report.pattern = settings.pattern;
  report.brightness = settings.brightness;
  report.maxBrightness = LED_BRIGHTNESS_MAX;
  report.sensorReady = imuReady();
  report.tilt = imuTiltFwd();
  report.neutralCalibrated = settings.neutralCalibrated;
  report.neutralOffsetDeg = settings.neutralOffsetDeg;
  report.calibration = calibrationText();
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
      if (neutralCapture.capturing()) {
        sendAck(command.type, false, "already-capturing");
        return;
      }
      neutralCapture.start(millis(), imuReady());
      sendAck(command.type, neutralCapture.capturing(),
              neutralFailureReason(neutralCapture.state()));
      break;

    case CommandType::Debug:
      debugEnabled = command.on;
      sendAck(command.type, true);
      break;
  }
  statusPending = true;
}

// Reports a capture's progress once per state change. A success applies the new
// offset and saves it right away, because a calibration is worth more than the wear
// of one write. A failure leaves the previous offset and saved settings alone.
static void updateNeutralCapture() {
  neutralCapture.poll(millis());
  const NeutralState state = neutralCapture.state();
  if (state == reportedNeutralState) return;
  reportedNeutralState = state;

  if (state == NeutralState::Succeeded) {
    settings.neutralOffsetDeg = neutralCapture.offsetDeg();
    settings.neutralCalibrated = true;
    imuSetNeutralOffsetDeg(settings.neutralOffsetDeg);
    saveNow();
  }

  char line[REMOTE_LINE_MAX];
  formatCalibration(line, sizeof(line), state, settings.neutralOffsetDeg, imuTiltFwd());
  remoteSend(line);
  statusPending = true;
}

// Lines stay under the motion rate limit, and they drop first if BLE falls behind.
static void sendMotionIfDue(unsigned long now) {
  if (!debugEnabled || (now - lastMotionMs) < REMOTE_MOTION_REPORT_MS) return;
  lastMotionMs = now;

  char line[REMOTE_LINE_MAX];
  formatMotion(line, sizeof(line), imuTiltFwd(), imuRawAngleDeg(), imuLatest().mag,
               imuGyroMagnitude(), stompSinceReport, imuStompStrength());
  remoteSend(line, RemotePriority::Telemetry);
  stompSinceReport = false;
}

// Draws one frame, at most every APP_FRAME_MS so the strip can't take all of the
// loop's time from the sensor and the radio. With the strip off, a black frame now
// and then keeps it dark if the strip's power was cycled separately.
static void renderIfDue(unsigned long now) {
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
  imuSetNeutralOffsetDeg(settings.neutralCalibrated ? settings.neutralOffsetDeg : 0.0f);

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
    neutralCapture.addSample(millis(), imuRawAngleDeg(), imuGyroMagnitude(), imuLatest().mag);
  }
  updateNeutralCapture();

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

  updateStatusLight(neutralCapture.capturing() ? StatusLight::Calibrating
                    : imuReady()               ? StatusLight::Running
                                               : StatusLight::SensorMissing);
  remoteUpdate();
}

}  // namespace FinalAppMode
