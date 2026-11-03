#pragma once

// Pure settings logic: what each controller remembers across power cycles, how
// that is checked when read back from flash, and when a change is worth writing.
// Arduino-free so test/test_settings can exercise it off-hardware. The flash
// reads and writes themselves live in firewalker_settings_store.h.
//
// Both shoes run the same firmware binary, so nothing here is compiled in per
// shoe: each controller's settings exist only in its own flash.

#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace Firewalker {

// Stable identifiers saved to flash. Never renumber these, since a saved value
// has to keep its meaning even if the list of patterns is reordered.
enum class PatternId : uint8_t {
  Flow = 1,
  FireTrail = 2,
  Off = 3,
};

struct Settings {
  PatternId pattern;
  // The pattern turning back on returns to. Always Flow or FireTrail.
  PatternId lastLitPattern;
  uint8_t brightness;
  bool neutralCalibrated;
  float neutralOffsetDeg;
};

struct SettingsBounds {
  uint8_t minBrightness;
  uint8_t maxBrightness;
  float maxNeutralOffsetDeg;
};

// First-boot settings: flow at the given brightness, uncalibrated, zero offset.
inline Settings defaultSettings(uint8_t brightness) {
  return Settings{PatternId::Flow, PatternId::Flow, brightness, false, 0.0f};
}

inline bool isPatternId(uint8_t value) {
  return value == (uint8_t)PatternId::Flow || value == (uint8_t)PatternId::FireTrail ||
         value == (uint8_t)PatternId::Off;
}

// The fixed-size record stored in flash. The magic number and version let a future
// firmware recognize this layout, and the CRC catches a damaged or partial record.
struct SettingsRecord {
  uint32_t magic;
  uint16_t version;
  uint8_t pattern;
  uint8_t lastLitPattern;
  uint8_t brightness;
  uint8_t neutralCalibrated;
  uint8_t reserved[2];
  float neutralOffsetDeg;
  uint32_t crc;
};

constexpr uint32_t SETTINGS_MAGIC = 0x46574C4B;  // "FWLK"
constexpr uint16_t SETTINGS_VERSION = 1;

enum class SettingsDecode : uint8_t {
  Ok,
  Corrupt,      // the checksum doesn't match, or the magic number is wrong
  Unsupported,  // a valid record from a different settings version
  Invalid,      // a valid record holding values outside the allowed bounds
};

// CRC-32 of a byte range, the common zlib polynomial. Bitwise rather than a lookup
// table, since it only runs on a settings load or save.
inline uint32_t settingsCrc(const void* data, size_t length) {
  const uint8_t* bytes = (const uint8_t*)data;
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < length; i++) {
    crc ^= bytes[i];
    for (uint8_t bit = 0; bit < 8; bit++) {
      crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
    }
  }
  return ~crc;
}

inline SettingsRecord encodeSettings(const Settings& settings) {
  SettingsRecord record;
  memset(&record, 0, sizeof(record));
  record.magic = SETTINGS_MAGIC;
  record.version = SETTINGS_VERSION;
  record.pattern = (uint8_t)settings.pattern;
  record.lastLitPattern = (uint8_t)settings.lastLitPattern;
  record.brightness = settings.brightness;
  record.neutralCalibrated = settings.neutralCalibrated ? 1 : 0;
  record.neutralOffsetDeg = settings.neutralOffsetDeg;
  record.crc = settingsCrc(&record, offsetof(SettingsRecord, crc));
  return record;
}

// Checks a record read back from flash. On Ok, `out` holds the saved settings; on
// anything else `out` is untouched, so the caller can keep its defaults.
inline SettingsDecode decodeSettings(const SettingsRecord& record,
                                     const SettingsBounds& bounds, Settings& out) {
  if (record.magic != SETTINGS_MAGIC ||
      record.crc != settingsCrc(&record, offsetof(SettingsRecord, crc))) {
    return SettingsDecode::Corrupt;
  }
  if (record.version != SETTINGS_VERSION) return SettingsDecode::Unsupported;

  const bool lastLitValid = record.lastLitPattern == (uint8_t)PatternId::Flow ||
                            record.lastLitPattern == (uint8_t)PatternId::FireTrail;
  const bool offsetValid = isfinite(record.neutralOffsetDeg) &&
                           fabsf(record.neutralOffsetDeg) <= bounds.maxNeutralOffsetDeg;
  if (!isPatternId(record.pattern) || !lastLitValid || !offsetValid ||
      record.brightness < bounds.minBrightness ||
      record.brightness > bounds.maxBrightness) {
    return SettingsDecode::Invalid;
  }

  out.pattern = (PatternId)record.pattern;
  out.lastLitPattern = (PatternId)record.lastLitPattern;
  out.brightness = record.brightness;
  out.neutralCalibrated = record.neutralCalibrated != 0;
  out.neutralOffsetDeg = record.neutralOffsetDeg;
  return SettingsDecode::Ok;
}

// Decides when accepted changes should reach flash. Dragging a brightness slider
// sends many updates a second, and flash wears out with writes, so a run of changes
// becomes one write: it waits for the changes to pause, but never longer than
// `maxMs` after the first unsaved one.
class SaveScheduler {
 public:
  SaveScheduler(uint32_t quietMs, uint32_t maxMs) : quietMs_(quietMs), maxMs_(maxMs) {}

  void markChanged(uint32_t nowMs) {
    if (!dirty_) firstChangeMs_ = nowMs;
    dirty_ = true;
    lastChangeMs_ = nowMs;
  }

  // Elapsed times are signed, so a `nowMs` read just before the latest change counts
  // as no time passed rather than wrapping around to about 49 days.
  bool due(uint32_t nowMs) const {
    return dirty_ && ((int32_t)(nowMs - lastChangeMs_) >= (int32_t)quietMs_ ||
                      (int32_t)(nowMs - firstChangeMs_) >= (int32_t)maxMs_);
  }

  void markSaved() { dirty_ = false; }
  bool dirty() const { return dirty_; }

 private:
  uint32_t quietMs_;
  uint32_t maxMs_;
  uint32_t firstChangeMs_ = 0;
  uint32_t lastChangeMs_ = 0;
  bool dirty_ = false;
};

}  // namespace Firewalker
