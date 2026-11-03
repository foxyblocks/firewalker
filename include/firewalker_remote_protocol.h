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

#include "firewalker_neutral.h"
#include "firewalker_settings.h"

namespace Firewalker {

// Long enough for any valid command, so a longer line is rejected rather than cut.
constexpr size_t REMOTE_COMMAND_MAX = 48;
// Long enough for the largest status line.
constexpr size_t REMOTE_LINE_MAX = 320;

enum class CommandType : uint8_t {
  Invalid,
  Status,
  Pattern,
  Power,
  Brightness,
  Calibrate,
  Debug,
};

struct Command {
  CommandType type = CommandType::Invalid;
  PatternId pattern = PatternId::Flow;  // for Pattern
  bool on = false;                      // for Power and Debug
  int32_t value = 0;                    // for Brightness
  const char* error = nullptr;          // for Invalid: why it was rejected
};

inline const char* patternName(PatternId pattern) {
  switch (pattern) {
    case PatternId::Flow: return "flow";
    case PatternId::FireTrail: return "fire-trail";
    case PatternId::Off: return "off";
  }
  return "unknown";
}

inline const char* commandName(CommandType type) {
  switch (type) {
    case CommandType::Status: return "status";
    case CommandType::Pattern: return "pattern";
    case CommandType::Power: return "power";
    case CommandType::Brightness: return "brightness";
    case CommandType::Calibrate: return "calibrate";
    case CommandType::Debug: return "debug";
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

  // Split into at most three words.
  char* words[3] = {nullptr, nullptr, nullptr};
  uint8_t count = 0;
  char* cursor = strtok(buffer, " \t\r\n");
  while (cursor) {
    if (count == 3) {
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

  if (strcmp(verb, "status") == 0 || strcmp(verb, "calibrate") == 0) {
    if (count != 1) {
      command.error = "too-many-arguments";
      return command;
    }
    command.type = (verb[0] == 's') ? CommandType::Status : CommandType::Calibrate;
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
    if (strcmp(arg, "flow") == 0) {
      command.pattern = PatternId::Flow;
    } else if (strcmp(arg, "fire-trail") == 0) {
      command.pattern = PatternId::FireTrail;
    } else if (strcmp(arg, "off") == 0) {
      command.pattern = PatternId::Off;
    } else {
      command.error = "unknown-pattern";
      return command;
    }
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

inline const char* neutralFailureReason(NeutralState state) {
  switch (state) {
    case NeutralState::FailedMotion: return "motion";
    case NeutralState::FailedNoSamples: return "no-samples";
    case NeutralState::FailedUnavailable: return "sensor-unavailable";
    case NeutralState::FailedOutOfRange: return "out-of-range";
    default: return "none";
  }
}

// The state a capture just reached: "capturing", "ok", or "failed" with a reason.
inline void formatCalibration(char* out, size_t size, NeutralState state, float offsetDeg,
                              float tilt) {
  if (state == NeutralState::Capturing) {
    snprintf(out, size, "{\"t\":\"calibrate\",\"state\":\"capturing\"}");
  } else if (state == NeutralState::Succeeded) {
    char offsetText[16];
    char tiltText[16];
    formatFixed2(offsetText, sizeof(offsetText), offsetDeg);
    formatFixed2(tiltText, sizeof(tiltText), tilt);
    snprintf(out, size, "{\"t\":\"calibrate\",\"state\":\"ok\",\"neutralDeg\":%s,\"tilt\":%s}",
             offsetText, tiltText);
  } else {
    snprintf(out, size, "{\"t\":\"calibrate\",\"state\":\"failed\",\"reason\":\"%s\"}",
             neutralFailureReason(state));
  }
}

// Everything the status line reports. These are the firmware's actual values, so a
// reconnecting client sees the current state rather than what it last asked for.
struct StatusReport {
  const char* id;
  PatternId pattern;
  uint8_t brightness;
  uint8_t maxBrightness;
  bool sensorReady;
  float tilt;
  bool neutralCalibrated;
  float neutralOffsetDeg;
  const char* calibration;  // "idle", "capturing", "ok", or a failure reason
  bool saved;               // the current settings are all in flash
  bool saveFailed;          // the most recent flash write failed
  uint32_t saves;           // flash writes since boot
  bool debug;
  bool bleConnected;
};

inline void formatStatus(char* out, size_t size, const StatusReport& report) {
  char tiltText[16];
  char offsetText[16];
  formatFixed2(tiltText, sizeof(tiltText), report.tilt);
  formatFixed2(offsetText, sizeof(offsetText), report.neutralOffsetDeg);
  snprintf(out, size,
           "{\"t\":\"status\",\"id\":\"%s\",\"pattern\":\"%s\",\"brightness\":%u,"
           "\"maxBrightness\":%u,\"sensor\":\"%s\",\"tilt\":%s,\"calibrated\":%s,"
           "\"neutralDeg\":%s,\"calibration\":\"%s\",\"saved\":%s,\"saveFailed\":%s,"
           "\"saves\":%lu,\"debug\":%s,\"ble\":%s}",
           report.id, patternName(report.pattern), (unsigned)report.brightness,
           (unsigned)report.maxBrightness, report.sensorReady ? "ok" : "unavailable", tiltText,
           report.neutralCalibrated ? "true" : "false", offsetText, report.calibration,
           report.saved ? "true" : "false", report.saveFailed ? "true" : "false",
           (unsigned long)report.saves, report.debug ? "true" : "false",
           report.bleConnected ? "true" : "false");
}

// One line of live motion, sent while debug is on. `stomp` means a stomp fired
// since the previous motion line.
inline void formatMotion(char* out, size_t size, float tilt, float angleDeg, float accel,
                         float gyro, bool stomp, float strength) {
  char tiltText[16];
  char angleText[16];
  char accelText[16];
  char gyroText[16];
  char strengthText[16];
  formatFixed2(tiltText, sizeof(tiltText), tilt);
  formatFixed2(angleText, sizeof(angleText), angleDeg);
  formatFixed2(accelText, sizeof(accelText), accel);
  formatFixed2(gyroText, sizeof(gyroText), gyro);
  formatFixed2(strengthText, sizeof(strengthText), strength);
  snprintf(out, size,
           "{\"t\":\"motion\",\"tilt\":%s,\"angleDeg\":%s,\"accel\":%s,\"gyro\":%s,"
           "\"stomp\":%s,\"strength\":%s}",
           tiltText, angleText, accelText, gyroText, stomp ? "true" : "false", strengthText);
}

}  // namespace Firewalker
