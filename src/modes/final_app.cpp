// final_app is the shoe app, and the same binary runs on both shoes. The onboard
// sensor drives the active pattern, the remote (BLE or the USB console) changes
// settings, and each controller keeps its own pattern, brightness, calibrated
// poses, and strip layout in flash. Losing the phone never matters: whatever is
// running keeps running, and a reconnecting client is told the current state.
//
// Each loop pass reads the sensor, handles any remote commands, saves settings that
// are due, and renders at most one frame. See docs/remote-protocol.md for commands.

#include "modes/final_app.h"

#include <Arduino.h>

#include "config.h"
#include "firewalker_core.h"
#include "firewalker_calibration.h"
#include "firewalker_imu.h"
#include "firewalker_pattern_list.h"
#include "firewalker_remote.h"
#include "firewalker_remote_protocol.h"
#include "firewalker_settings.h"
#include "firewalker_settings_store.h"
#include "generated/recipe_builtins.h"
#include "patterns/fire_trail.h"
#include "patterns/flow.h"
#include "patterns/pattern.h"
#include "patterns/recipe_pattern.h"

namespace FinalAppMode {

using namespace Firewalker;

static constexpr SettingsBounds SETTINGS_BOUNDS = {LED_BRIGHTNESS_MIN, LED_BRIGHTNESS_MAX,
                                                   TILT_LIMITS.maxNeutralDeg, STRIP_MAX_PIXELS};
static constexpr PoseCaptureLimits CAPTURE_LIMITS = {
    CALIBRATION_WINDOW_MS, CALIBRATION_NO_SAMPLE_MS, CALIBRATION_MIN_SAMPLES,
    CALIBRATION_MAX_SPREAD_DEG};

static FlowPattern flow;
static FireTrailPattern fireTrail;
static RecipePattern recipePattern;
static Pattern* activePattern = nullptr;  // null when the strip is off

static UploadedRecipe uploads[RECIPE_SLOTS];
static const PatternCatalog CATALOG = {RECIPE_BUILTINS, RECIPE_BUILTIN_COUNT, uploads, RECIPE_SLOTS};

static Settings settings = defaultSettings(LED_BRIGHTNESS, STRIP_DEFAULT_LAYOUT);
static SaveScheduler saveScheduler(SETTINGS_SAVE_QUIET_MS, SETTINGS_SAVE_MAX_MS);
static bool saveFailed = false;

static PoseCalibrator calibrator(CAPTURE_LIMITS, TILT_LIMITS);

static bool identifying = false;
static unsigned long identifyStartMs = 0;

static bool stripPreview = false;
static unsigned long lastStripCommandMs = 0;  // a preview ends STRIP_PREVIEW_HOLD_MS after this

static bool debugEnabled = false;
static bool statusPending = false;
static bool stompPending = false;         // fired since the last frame
static bool stompSinceReport = false;     // fired since the last motion line
static float accelPeak = 0.0f;            // highest acceleration since the last motion line
static unsigned long lastFrameMs = 0;
static unsigned long lastPatternUpdateMs = 0;
static unsigned long lastStatusMs = 0;
static unsigned long lastMotionMs = 0;
static uint32_t slowestFrameUs = 0;       // slowest pattern update since the last motion line

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
  report.calibrationState = calibrator.statusText();
  report.saved = !saveScheduler.dirty() && !saveFailed;
  report.saveFailed = saveFailed;
  report.saves = settingsWriteCount();
  report.debug = debugEnabled;
  report.bleConnected = remoteBleConnected();
  report.strip = settings.strip;
  report.maxLeds = STRIP_MAX_PIXELS;
  report.preview = stripPreview;

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

static void sendPatterns() {
  const char* names[PATTERN_LIST_MAX];
  const uint8_t count = listPatterns(CATALOG, names, PATTERN_LIST_MAX);
  char line[REMOTE_LINE_MAX];
  formatPatterns(line, sizeof(line), names, count);
  remoteSend(line);
}

// Puts what a name refers to on the strip. Returns false if the name doesn't mean anything on this
// boot or its recipe won't load, and the strip then stays as it was. Motion processing carries on
// either way, so turning the strip back on picks up the current tilt straight away.
static bool tryShowPattern(const char* name) {
  const PatternLookup found = findPattern(CATALOG, name);
  Pattern* next = nullptr;
  switch (found.source) {
    case PatternSource::Unknown:
      return false;
    case PatternSource::Off:
      break;
    case PatternSource::Native:
      next = found.index == 0 ? (Pattern*)&flow : (Pattern*)&fireTrail;
      break;
    case PatternSource::BuiltIn: {
      const BuiltInRecipe& recipe = RECIPE_BUILTINS[found.index];
      if (recipePattern.load(recipe.bytes, recipe.size) != RecipeDecodeResult::Ok) return false;
      next = &recipePattern;
      break;
    }
    case PatternSource::Uploaded:
      return false;
  }

  activePattern = next;
  if (activePattern) {
    activePattern->enter();
  } else {
    strip.clear();
    strip.show();
  }
  stompPending = false;
  lastPatternUpdateMs = millis();
  return true;
}

// Shows the saved pattern. A saved name can stop existing, because a recipe can be deleted, so the
// boot then falls back to flow and saves that. It keeps its brightness, poses, and strip layout.
static void showSavedPattern() {
  if (findPattern(CATALOG, settings.lastLitPattern).source == PatternSource::Unknown) {
    copyPatternName(settings.lastLitPattern, PATTERN_DEFAULT);
    saveScheduler.markChanged(millis());
  }
  if (tryShowPattern(settings.pattern)) return;
  Serial.print(F("[firewalker] can't show saved pattern: "));
  Serial.println(settings.pattern);
  copyPatternName(settings.pattern, PATTERN_DEFAULT);
  saveScheduler.markChanged(millis());
  tryShowPattern(settings.pattern);
}

// Returns false if the pattern can't be shown, which leaves the settings and the strip alone.
static bool selectPattern(const char* name) {
  if (strcmp(name, settings.pattern) != 0) {
    if (!tryShowPattern(name)) return false;
    copyPatternName(settings.pattern, name);
  } else if (findPattern(CATALOG, name).source == PatternSource::Unknown) {
    return false;
  }
  if (strcmp(name, PATTERN_OFF) != 0) copyPatternName(settings.lastLitPattern, name);
  saveScheduler.markChanged(millis());
  return true;
}

// Shows or stops showing a strip layout preview, which takes over the strip from the
// pattern without changing any settings. Each call keeps a preview alive for another
// STRIP_PREVIEW_HOLD_MS. Stopping brings back the saved brightness and restarts the pattern.
static void setStripPreview(bool on) {
  lastStripCommandMs = millis();
  if (on == stripPreview) return;
  stripPreview = on;
  if (!on) {
    strip.setBrightness(settings.brightness);
    showSavedPattern();
  }
}

static void handleCommand(const Command& command) {
  switch (command.type) {
    case CommandType::Invalid:
      sendAck(CommandType::Invalid, false, command.error);
      return;

    case CommandType::Status:
      sendStatus();
      return;

    case CommandType::Patterns:
      sendPatterns();
      return;

    // Blinks the strip so you can see which boot this is. It changes no settings, so
    // there's nothing new to report and nothing to save.
    case CommandType::Identify:
      identifying = true;
      identifyStartMs = millis();
      sendAck(command.type, true);
      return;

    case CommandType::Pattern:
      if (findPattern(CATALOG, command.pattern).source == PatternSource::Unknown) {
        sendAck(command.type, false, "unknown-pattern");
        return;
      }
      if (!selectPattern(command.pattern)) {
        sendAck(command.type, false, "bad-recipe");
        return;
      }
      sendAck(command.type, true);
      break;

    case CommandType::Power: {
      char target[PATTERN_NAME_SIZE];
      copyPatternName(target, command.on ? settings.lastLitPattern : PATTERN_OFF);
      if (!selectPattern(target)) showSavedPattern();
      sendAck(command.type, true);
      break;
    }

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

    case CommandType::Calibrate: {
      const char* refusal = calibrator.start(command.pose, millis(), imuReady());
      sendAck(command.type, refusal == nullptr, refusal);
      break;
    }

    case CommandType::Debug:
      debugEnabled = command.on;
      sendAck(command.type, true);
      break;

    // Saves after the changes pause, so dragging a slider becomes one flash write. Patterns
    // read the layout when they enter, so one showing now restarts to pick it up. A preview
    // draws straight from the settings, and the pattern restarts when the preview ends.
    case CommandType::StripSet: {
      const char* failure =
          applyStripSetting(settings.strip, command.stripField, command.value, STRIP_MAX_PIXELS);
      if (failure) {
        sendAck(command.type, false, failure);
        return;
      }
      setStripLayout(settings.strip);
      saveScheduler.markChanged(millis());
      lastStripCommandMs = millis();
      if (!stripPreview) showSavedPattern();
      sendAck(command.type, true);
      break;
    }

    case CommandType::StripPreview:
      setStripPreview(command.on);
      sendAck(command.type, true);
      break;
  }
  statusPending = true;
}

// Tells clients about each change in a capture. An applied pose is saved right away, because a
// calibration is worth more than the wear of one write. A failure has changed nothing, in use
// or in flash.
static void updatePoseCapture() {
  const CaptureReport report = calibrator.update(millis(), settings.calibration);
  if (report.kind == CaptureReportKind::None) return;

  char line[REMOTE_LINE_MAX];
  if (report.kind == CaptureReportKind::Started) {
    formatCalibrationCapturing(line, sizeof(line), report.pose);
  } else if (report.kind == CaptureReportKind::Failed) {
    formatCalibrationFailed(line, sizeof(line), report.pose, report.reason);
  } else {
    imuSetCalibration(settings.calibration);
    saveNow();
    formatCalibrationOk(line, sizeof(line), report.pose, report.angleDeg, imuTiltFwd());
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
               imuGyroMagnitude(), stompSinceReport, imuStompStrength(), slowestFrameUs);
  remoteSend(line, RemotePriority::Telemetry);
  stompSinceReport = false;
  accelPeak = 0.0f;
  slowestFrameUs = 0;
}

// Draws the whole strip layout at once: the ring in blue, with the toe and heel pixels in
// their own colors on top. Past the end of the ring stays dark, so on an uncut strip you can
// see where the ring ends, and you can see all three settings while changing any of them.
static void drawStripPreview() {
  strip.setBrightness(STRIP_PREVIEW_BRIGHTNESS);
  strip.clear();
  for (uint16_t i = 0; i < strip.numPixels(); i++) strip.setPixelColor(i, STRIP_PREVIEW_LEDS_COLOR);
  strip.setPixelColor(settings.strip.toe, STRIP_PREVIEW_TOE_COLOR);
  strip.setPixelColor(settings.strip.heel, STRIP_PREVIEW_HEEL_COLOR);
  strip.show();
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
      showSavedPattern();
    } else if ((now - lastFrameMs) >= APP_FRAME_MS) {
      lastFrameMs = now;
      const uint32_t color = ((elapsed / IDENTIFY_BLINK_MS) % 2 == 0) ? 0xFFFFFF : 0x000000;
      for (uint16_t i = 0; i < strip.numPixels(); i++) strip.setPixelColor(i, color);
      strip.show();
    }
    return;
  }

  if (stripPreview) {
    stompPending = false;
    if ((now - lastFrameMs) >= APP_FRAME_MS) {
      lastFrameMs = now;
      drawStripPreview();
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
  input.tiltDeg = imuTiltDeg();
  input.stomp = stompPending;
  input.stompStrength = imuStompStrength();
  input.dt = now - lastPatternUpdateMs;
  lastPatternUpdateMs = now;
  stompPending = false;
  const uint32_t updateStart = micros();
  activePattern->update(input);
  const uint32_t updateUs = micros() - updateStart;
  if (updateUs > slowestFrameUs) slowestFrameUs = updateUs;
}

void setup() {
  setupCore(F("final_app"));

  const char* loaded = loadSettings(SETTINGS_BOUNDS, settings);
  Serial.print(F("[firewalker] settings: "));
  Serial.println(loaded);

  imuBegin();
  imuSetCalibration(settings.calibration);

  remoteBegin();
  setStripLayout(settings.strip);
  strip.setBrightness(settings.brightness);
  showSavedPattern();
  sendStatus();
}

void loop() {
  if (imuUpdate()) {
    if (imuTakeStomp()) {
      stompPending = true;
      stompSinceReport = true;
    }
    if (imuLatest().mag > accelPeak) accelPeak = imuLatest().mag;
    calibrator.addSample(millis(), imuRawAngleDeg());
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

  if (stripPreview && (now - lastStripCommandMs) >= STRIP_PREVIEW_HOLD_MS) {
    setStripPreview(false);
    statusPending = true;
  }

  if (remoteTakeClientReady()) statusPending = true;
  if (statusPending && (now - lastStatusMs) >= REMOTE_STATUS_MIN_MS) sendStatus();
  sendMotionIfDue(now);

  renderIfDue(now);

  updateStatusLight((calibrator.capturing() || identifying) ? StatusLight::Calibrating
                    : imuReady()                             ? StatusLight::Running
                                                             : StatusLight::SensorMissing);
  remoteUpdate();
}

}  // namespace FinalAppMode
