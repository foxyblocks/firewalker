#pragma once

// Pure remote-control protocol shared by the BLE service and the USB console, so
// both speak the same language and it can be tested off-hardware
// (test/test_remote_protocol). A client sends one short text command per line and
// the firmware answers with one JSON object per line. The full reference is
// docs/remote-protocol.md.
//
//   > brightness 32
//   < {"t":"ack","cmd":"brightness","ok":true}
//   < {"t":"status","pattern":"flow","brightness":32,...}
//
// Every formatter writes into a caller-owned buffer and truncates safely rather
// than overflowing. Nothing here allocates. Numbers format without printf's float
// support, which the firmware's small C library leaves out.

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "firewalker_calibration.h"
#include "firewalker_pattern_list.h"
#include "firewalker_settings.h"

namespace Firewalker {

// Long enough for any valid command, so a longer line is rejected rather than cut.
constexpr size_t REMOTE_COMMAND_MAX = 48;
// Long enough for the largest status line, and for the longest `patterns` list: 32 names of 12
// characters, plus quotes and commas.
constexpr size_t REMOTE_LINE_MAX = 520;
// Reported in status, so an app can tell when a boot's firmware needs updating. Raise it
// when a change would break a client written against the current protocol, or when clients
// start relying on something earlier firmware doesn't have. 2 added the strip layout, and 3 added
// recipes.
constexpr uint8_t REMOTE_PROTOCOL_VERSION = 3;

enum class CommandType : uint8_t {
  Invalid,
  Status,
  Patterns,
  Pattern,
  Power,
  Brightness,
  Calibrate,
  Debug,
  Identify,
  StripSet,
  StripPreview,
  Recipes,
  RecipeInfo,
  RecipeBegin,
  RecipeData,
  RecipeEnd,
  RecipeCancel,
  RecipeDelete,
};

// The most hex characters a `recipe data` line can carry. See RECIPE_DATA_MAX_HEX.
constexpr size_t REMOTE_RECIPE_HEX_MAX = 30;

struct Command {
  CommandType type = CommandType::Invalid;
  // For Pattern, RecipeInfo, and RecipeDelete. Spelled legally, but it may not exist.
  char pattern[PATTERN_NAME_SIZE] = "";
  char hex[REMOTE_RECIPE_HEX_MAX + 1] = "";  // for RecipeData
  CalibrationPose pose = CalibrationPose::Neutral;  // for Calibrate
  bool on = false;                      // for Power, Debug, and StripPreview
  int32_t value = 0;                    // for Brightness, StripSet, RecipeBegin (size), and RecipeData (offset)
  StripField stripField = StripField::Count;   // for StripSet
  const char* error = nullptr;          // for Invalid: why it was rejected
};

inline const char* poseName(CalibrationPose pose) {
  switch (pose) {
    case CalibrationPose::Neutral: return "neutral";
    case CalibrationPose::Heel: return "heel";
    case CalibrationPose::Toe: return "toe";
  }
  return "unknown";
}

inline const char* commandName(CommandType type) {
  switch (type) {
    case CommandType::Status: return "status";
    case CommandType::Patterns: return "patterns";
    case CommandType::Identify: return "identify";
    case CommandType::Pattern: return "pattern";
    case CommandType::Power: return "power";
    case CommandType::Brightness: return "brightness";
    case CommandType::Calibrate: return "calibrate";
    case CommandType::Debug: return "debug";
    case CommandType::StripSet: return "strip";
    case CommandType::StripPreview: return "strip";
    case CommandType::Recipes: return "recipes";
    case CommandType::RecipeInfo:
    case CommandType::RecipeBegin:
    case CommandType::RecipeData:
    case CommandType::RecipeEnd:
    case CommandType::RecipeCancel:
    case CommandType::RecipeDelete: return "recipe";
    case CommandType::Invalid: break;
  }
  return "unknown";
}

// Parses "on"/"off". Returns false for anything else.
inline bool parseOnOff(const char* word, bool& out) {
  if (word && strcmp(word, "on") == 0) {
    out = true;
    return true;
  }
  if (word && strcmp(word, "off") == 0) {
    out = false;
    return true;
  }
  return false;
}

// Parses the words after `strip`: a setting and its pixel number, or `preview` and on or
// off. Whether a number fits this strip is the caller's check (applyStripSetting), so
// this only rejects what isn't a pixel number at all.
inline void parseStripCommand(const char* setting, const char* value, Command& command) {
  if (strcmp(setting, "preview") == 0) {
    if (!parseOnOff(value, command.on)) {
      command.error = "expected-on-or-off";
      return;
    }
    command.type = CommandType::StripPreview;
    return;
  }

  if (strcmp(setting, "leds") == 0) {
    command.stripField = StripField::Count;
  } else if (strcmp(setting, "toe") == 0) {
    command.stripField = StripField::Toe;
  } else if (strcmp(setting, "heel") == 0) {
    command.stripField = StripField::Heel;
  } else {
    command.error = "unknown-strip-setting";
    return;
  }

  char* end = nullptr;
  const long number = strtol(value, &end, 10);
  if (end == value || *end != '\0' || number < 0 || number > 65535) {
    command.error = "expected-number";
    return;
  }
  command.value = (int32_t)number;
  command.type = CommandType::StripSet;
}

// A size or an offset in a `recipe` command. Returns false for anything but a small whole number.
inline bool parseRecipeNumber(const char* word, int32_t& out) {
  char* end = nullptr;
  const long number = strtol(word, &end, 10);
  if (end == word || *end != '\0' || number < 0 || number > 65535) return false;
  out = (int32_t)number;
  return true;
}

// Parses the words after `recipe`. `count` includes `recipe` itself. Whether a size, offset, or name
// suits the upload in progress is the caller's check, so this only rejects what can't be right at all.
inline void parseRecipeCommand(char* const* words, uint8_t count, Command& command) {
  if (count < 2) {
    command.error = "expected-recipe-command";
    return;
  }
  const char* action = words[1];

  if (strcmp(action, "end") == 0 || strcmp(action, "cancel") == 0) {
    if (count != 2) {
      command.error = "too-many-arguments";
      return;
    }
    command.type = action[0] == 'e' ? CommandType::RecipeEnd : CommandType::RecipeCancel;
    return;
  }

  if (strcmp(action, "info") == 0 || strcmp(action, "delete") == 0) {
    if (count != 3) {
      command.error = "expected-one-argument";
      return;
    }
    if (!patternNameValid(words[2])) {
      command.error = "bad-name";
      return;
    }
    copyPatternName(command.pattern, words[2]);
    command.type = action[0] == 'i' ? CommandType::RecipeInfo : CommandType::RecipeDelete;
    return;
  }

  if (strcmp(action, "begin") == 0) {
    if (count != 4) {
      command.error = "expected-name-and-size";
      return;
    }
    if (!patternNameValid(words[2])) {
      command.error = "bad-name";
      return;
    }
    if (!parseRecipeNumber(words[3], command.value)) {
      command.error = "expected-number";
      return;
    }
    copyPatternName(command.pattern, words[2]);
    command.type = CommandType::RecipeBegin;
    return;
  }

  if (strcmp(action, "data") == 0) {
    if (count != 4) {
      command.error = "expected-offset-and-hex";
      return;
    }
    if (!parseRecipeNumber(words[2], command.value)) {
      command.error = "expected-number";
      return;
    }
    if (strlen(words[3]) > REMOTE_RECIPE_HEX_MAX) {
      command.error = "bad-hex";
      return;
    }
    strcpy(command.hex, words[3]);
    command.type = CommandType::RecipeData;
    return;
  }

  command.error = "unknown-recipe-command";
}

// Parses one command line. Surrounding whitespace and a trailing CR or LF are
// ignored. A bad line returns type Invalid with `error` set. Range checks that
// depend on the build's limits, such as the brightness cap, belong to the caller.
inline Command parseCommand(const char* line) {
  Command command;
  if (!line) {
    command.error = "empty";
    return command;
  }
  if (strlen(line) >= REMOTE_COMMAND_MAX) {
    command.error = "too-long";
    return command;
  }

  char buffer[REMOTE_COMMAND_MAX];
  strcpy(buffer, line);

  // Split into words. Only `recipe` commands have a fourth, and that's checked below.
  char* words[4] = {nullptr, nullptr, nullptr, nullptr};
  uint8_t count = 0;
  char* cursor = strtok(buffer, " \t\r\n");
  while (cursor) {
    if (count == 4) {
      command.error = "too-many-arguments";
      return command;
    }
    words[count++] = cursor;
    cursor = strtok(nullptr, " \t\r\n");
  }
  if (count == 0) {
    command.error = "empty";
    return command;
  }

  const char* verb = words[0];
  const char* arg = words[1];

  if (strcmp(verb, "recipe") == 0) {
    parseRecipeCommand(words, count, command);
    return command;
  }
  if (count == 4) {
    command.error = "too-many-arguments";
    return command;
  }

  const bool isStatus = strcmp(verb, "status") == 0;
  const bool isPatterns = strcmp(verb, "patterns") == 0;
  const bool isIdentify = strcmp(verb, "identify") == 0;
  const bool isRecipes = strcmp(verb, "recipes") == 0;
  if (isStatus || isPatterns || isIdentify || isRecipes) {
    if (count != 1) {
      command.error = "too-many-arguments";
      return command;
    }
    command.type = isStatus     ? CommandType::Status
                   : isPatterns ? CommandType::Patterns
                   : isRecipes  ? CommandType::Recipes
                                : CommandType::Identify;
    return command;
  }

  // A bare `calibrate` means neutral, the pose every boot needs first.
  if (strcmp(verb, "calibrate") == 0) {
    if (count > 2) {
      command.error = "too-many-arguments";
      return command;
    }
    if (arg == nullptr || strcmp(arg, "neutral") == 0) {
      command.pose = CalibrationPose::Neutral;
    } else if (strcmp(arg, "heel") == 0) {
      command.pose = CalibrationPose::Heel;
    } else if (strcmp(arg, "toe") == 0) {
      command.pose = CalibrationPose::Toe;
    } else {
      command.error = "unknown-pose";
      return command;
    }
    command.type = CommandType::Calibrate;
    return command;
  }

  if (strcmp(verb, "strip") == 0) {
    if (count != 3) {
      command.error = "expected-setting-and-value";
      return command;
    }
    parseStripCommand(arg, words[2], command);
    return command;
  }

  const bool isPattern = strcmp(verb, "pattern") == 0;
  const bool isOnOff = strcmp(verb, "power") == 0 || strcmp(verb, "debug") == 0;
  const bool isBrightness = strcmp(verb, "brightness") == 0;
  if (!isPattern && !isOnOff && !isBrightness) {
    command.error = "unknown-command";
    return command;
  }
  if (count != 2) {
    command.error = "expected-one-argument";
    return command;
  }

  if (isPattern) {
    // The list of patterns changes as recipes come and go, so whether one exists is the caller's
    // check. A name that isn't even spelled legally can't be one.
    if (!patternNameValid(arg)) {
      command.error = "unknown-pattern";
      return command;
    }
    copyPatternName(command.pattern, arg);
    command.type = CommandType::Pattern;
    return command;
  }

  if (isOnOff) {
    if (!parseOnOff(arg, command.on)) {
      command.error = "expected-on-or-off";
      return command;
    }
    command.type = (verb[0] == 'p') ? CommandType::Power : CommandType::Debug;
    return command;
  }

  char* end = nullptr;
  const long value = strtol(arg, &end, 10);
  if (end == arg || *end != '\0' || value < 0 || value > 255) {
    command.error = "expected-0-to-255";
    return command;
  }
  command.value = (int32_t)value;
  command.type = CommandType::Brightness;
  return command;
}

// Writes `value` with two decimals, such as -1.50, into at most `size` bytes.
inline void formatFixed2(char* out, size_t size, float value) {
  const bool negative = value < 0.0f;
  const float magnitude = negative ? -value : value;
  // Clamp rather than overflow the integer conversion on a wild reading.
  const uint32_t hundredths =
      (magnitude >= 1000000.0f) ? 100000000u : (uint32_t)(magnitude * 100.0f + 0.5f);
  snprintf(out, size, "%s%lu.%02lu", (negative && hundredths != 0) ? "-" : "",
           (unsigned long)(hundredths / 100), (unsigned long)(hundredths % 100));
}

inline void formatAck(char* out, size_t size, CommandType type, bool ok,
                      const char* error = nullptr) {
  if (ok) {
    snprintf(out, size, "{\"t\":\"ack\",\"cmd\":\"%s\",\"ok\":true}", commandName(type));
  } else {
    snprintf(out, size, "{\"t\":\"ack\",\"cmd\":\"%s\",\"ok\":false,\"error\":\"%s\"}",
             commandName(type), error ? error : "failed");
  }
}

// Why a capture itself failed. applyPose has its own reasons for a pose it rejects.
inline void formatCalibrationCapturing(char* out, size_t size, CalibrationPose pose) {
  snprintf(out, size, "{\"t\":\"calibrate\",\"pose\":\"%s\",\"state\":\"capturing\"}",
           poseName(pose));
}

inline void formatCalibrationOk(char* out, size_t size, CalibrationPose pose, float angleDeg,
                                float tilt) {
  char angleText[16];
  char tiltText[16];
  formatFixed2(angleText, sizeof(angleText), angleDeg);
  formatFixed2(tiltText, sizeof(tiltText), tilt);
  snprintf(out, size,
           "{\"t\":\"calibrate\",\"pose\":\"%s\",\"state\":\"ok\",\"angleDeg\":%s,\"tilt\":%s}",
           poseName(pose), angleText, tiltText);
}

inline void formatCalibrationFailed(char* out, size_t size, CalibrationPose pose,
                                    const char* reason) {
  snprintf(out, size, "{\"t\":\"calibrate\",\"pose\":\"%s\",\"state\":\"failed\",\"reason\":\"%s\"}",
           poseName(pose), reason);
}

// A reply to a `recipe` command that moves an upload along. `next` is the offset to send next, so a
// client can carry on after a lost line. Use a negative one to leave it out.
inline void formatRecipeAck(char* out, size_t size, bool ok, const char* error, int32_t next) {
  int written = snprintf(out, size, "{\"t\":\"ack\",\"cmd\":\"recipe\",\"ok\":%s", ok ? "true" : "false");
  if (written < 0 || (size_t)written >= size) return;
  if (error) written += snprintf(out + written, size - written, ",\"error\":\"%s\"", error);
  if (written < 0 || (size_t)written >= size) return;
  if (next >= 0) written += snprintf(out + written, size - written, ",\"next\":%ld", (long)next);
  if (written >= 0 && (size_t)written < size) snprintf(out + written, size - written, "}");
}

// The reply to `recipes`: the versions this firmware can read, and what's in its upload slots.
inline void formatRecipes(char* out, size_t size, uint8_t version, const UploadedRecipe* slots, uint8_t slotCount) {
  uint8_t used = 0;
  for (uint8_t i = 0; i < slotCount; i++) {
    if (slots[i].used) used++;
  }
  int written = snprintf(out, size, "{\"t\":\"recipes\",\"versions\":[%u],\"slots\":%u,\"free\":%u,\"list\":[",
                         (unsigned)version, (unsigned)slotCount, (unsigned)(slotCount - used));
  bool first = true;
  for (uint8_t i = 0; i < slotCount; i++) {
    if (!slots[i].used) continue;
    if (written < 0 || (size_t)written >= size) return;
    written += snprintf(out + written, size - written, "%s\"%s\"", first ? "" : ",", slots[i].name);
    first = false;
  }
  if (written >= 0 && (size_t)written < size) snprintf(out + written, size - written, "]}");
}

// The reply to `recipe info`, which lets a client see this boot already has a recipe, and skip sending it.
inline void formatRecipeInfo(char* out, size_t size, const UploadedRecipe& recipe) {
  snprintf(out, size, "{\"t\":\"recipe\",\"name\":\"%s\",\"bytes\":%u,\"crc\":\"%08lx\"}", recipe.name,
           (unsigned)recipe.size, (unsigned long)recipe.crc);
}

inline void formatPatterns(char* out, size_t size, const char* const* names, size_t count) {
  int written = snprintf(out, size, "{\"t\":\"patterns\",\"list\":[");
  bool first = true;
  for (size_t i = 0; i < count; i++) {
    if (written < 0 || (size_t)written >= size) return;
    written += snprintf(out + written, size - written, "%s\"%s\"", first ? "" : ",", names[i]);
    first = false;
  }
  if (written >= 0 && (size_t)written < size) {
    snprintf(out + written, size - written, "]}");
  }
}

// Everything the status line reports. These are the firmware's actual values, so a
// reconnecting client sees the current state rather than what it last asked for.
struct StatusReport {
  const char* id;
  const char* pattern;
  const char* lit;  // the pattern turning on returns to, even while the strip is off
  uint8_t brightness;
  uint8_t maxBrightness;
  bool sensorReady;
  float tilt;
  TiltCalibration calibration;
  const char* calibrationState;  // "idle", "capturing", "ok", or a failure reason
  bool saved;                    // the current settings are all in flash
  bool saveFailed;               // the most recent flash write failed
  uint32_t saves;                // flash writes since boot
  bool debug;
  bool bleConnected;
  StripLayout strip;
  uint16_t maxLeds;  // the longest strip this build can drive
  bool preview;      // the strip is showing its layout in place of the pattern
};

// Writes a pose's angle, or `null` if it hasn't been captured.
inline void formatOptionalAngle(char* out, size_t size, bool isSet, float angleDeg) {
  if (isSet) {
    formatFixed2(out, size, angleDeg);
  } else {
    snprintf(out, size, "null");
  }
}

inline void formatStatus(char* out, size_t size, const StatusReport& report) {
  char tiltText[16];
  char neutralText[16];
  char heelText[16];
  char toeText[16];
  formatFixed2(tiltText, sizeof(tiltText), report.tilt);
  formatFixed2(neutralText, sizeof(neutralText), report.calibration.neutralDeg);
  formatOptionalAngle(heelText, sizeof(heelText), report.calibration.heelSet,
                      report.calibration.heelDeg);
  formatOptionalAngle(toeText, sizeof(toeText), report.calibration.toeSet, report.calibration.toeDeg);
  snprintf(out, size,
           "{\"t\":\"status\",\"proto\":%u,\"id\":\"%s\",\"pattern\":\"%s\",\"lit\":\"%s\","
           "\"brightness\":%u,\"maxBrightness\":%u,\"sensor\":\"%s\",\"tilt\":%s,"
           "\"calibrated\":%s,\"neutralDeg\":%s,\"heelDeg\":%s,\"toeDeg\":%s,"
           "\"calibration\":\"%s\",\"saved\":%s,\"saveFailed\":%s,\"saves\":%lu,"
           "\"debug\":%s,\"ble\":%s,\"leds\":%u,\"maxLeds\":%u,\"toe\":%u,\"heel\":%u,"
           "\"preview\":%s}",
           (unsigned)REMOTE_PROTOCOL_VERSION, report.id, report.pattern,
           report.lit, (unsigned)report.brightness, (unsigned)report.maxBrightness,
           report.sensorReady ? "ok" : "unavailable", tiltText,
           report.calibration.neutralSet ? "true" : "false", neutralText, heelText, toeText,
           report.calibrationState, report.saved ? "true" : "false",
           report.saveFailed ? "true" : "false", (unsigned long)report.saves,
           report.debug ? "true" : "false", report.bleConnected ? "true" : "false",
           (unsigned)report.strip.count, (unsigned)report.maxLeds, (unsigned)report.strip.toe,
           (unsigned)report.strip.heel, report.preview ? "true" : "false");
}

// One line of live motion, sent while debug is on. `accelPeak` is the highest
// acceleration since the previous line, which catches a step's spike that a line's own
// instant would miss. `stomp` means a stomp fired since the previous line.
inline void formatMotion(char* out, size_t size, float tilt, float angleDeg, float accel,
                         float accelPeak, float gyro, bool stomp, float strength, uint32_t frameUs) {
  char tiltText[16];
  char angleText[16];
  char accelText[16];
  char peakText[16];
  char gyroText[16];
  char strengthText[16];
  formatFixed2(tiltText, sizeof(tiltText), tilt);
  formatFixed2(angleText, sizeof(angleText), angleDeg);
  formatFixed2(accelText, sizeof(accelText), accel);
  formatFixed2(peakText, sizeof(peakText), accelPeak);
  formatFixed2(gyroText, sizeof(gyroText), gyro);
  formatFixed2(strengthText, sizeof(strengthText), strength);
  snprintf(out, size,
           "{\"t\":\"motion\",\"tilt\":%s,\"angleDeg\":%s,\"accel\":%s,\"accelPeak\":%s,"
           "\"gyro\":%s,\"stomp\":%s,\"strength\":%s,\"frameUs\":%lu}",
           tiltText, angleText, accelText, peakText, gyroText, stomp ? "true" : "false", strengthText,
           (unsigned long)frameUs);
}

}  // namespace Firewalker
