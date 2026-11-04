#pragma once

// Pure settings logic: what each controller remembers across power cycles (its
// pattern, brightness, calibrated poses, and strip layout), how
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

#include "firewalker_calibration.h"
#include "firewalker_strip_map.h"

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
  TiltCalibration calibration;
  StripLayout strip;
};

struct SettingsBounds {
  uint8_t minBrightness;
  uint8_t maxBrightness;
  float maxNeutralDeg;
  uint16_t maxStripPixels;
};

// First-boot settings: flow at the given brightness, with no calibrated poses, on the
// strip layout this build starts from.
inline Settings defaultSettings(uint8_t brightness, const StripLayout& strip) {
  return Settings{PatternId::Flow, PatternId::Flow, brightness, TiltCalibration{}, strip};
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
  uint8_t calibratedPoses;  // the SETTINGS_POSE_* bits
  uint16_t stripCount;
  float neutralDeg;
  float heelDeg;
  float toeDeg;
  uint16_t stripToe;
  uint16_t stripHeel;
  uint32_t crc;
};

// The record boots saved before the strip layout became a setting. Flash still holds one
// of these on a boot's first start after that update, so it's read rather than discarded:
// otherwise updating the firmware would throw away that boot's calibrated poses.
struct SettingsRecordV2 {
  uint32_t magic;
  uint16_t version;
  uint8_t pattern;
  uint8_t lastLitPattern;
  uint8_t brightness;
  uint8_t calibratedPoses;
  uint8_t reserved[2];
  float neutralDeg;
  float heelDeg;
  float toeDeg;
  uint32_t crc;
};

// The store tells the versions apart by size, and a V2 record's size is fixed by what's
// already in flash.
static_assert(sizeof(SettingsRecordV2) == 28, "SettingsRecordV2 must match saved records");
static_assert(sizeof(SettingsRecord) != sizeof(SettingsRecordV2),
              "Record versions must differ in size");

constexpr uint32_t SETTINGS_MAGIC = 0x46574C4B;  // "FWLK"
constexpr uint16_t SETTINGS_VERSION = 3;
constexpr uint16_t SETTINGS_VERSION_V2 = 2;
constexpr uint8_t SETTINGS_POSE_NEUTRAL = 1 << 0;
constexpr uint8_t SETTINGS_POSE_HEEL = 1 << 1;
constexpr uint8_t SETTINGS_POSE_TOE = 1 << 2;

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
  record.stripCount = settings.strip.count;
  record.stripToe = settings.strip.toe;
  record.stripHeel = settings.strip.heel;
  const TiltCalibration& calibration = settings.calibration;
  record.calibratedPoses = (calibration.neutralSet ? SETTINGS_POSE_NEUTRAL : 0) |
                           (calibration.heelSet ? SETTINGS_POSE_HEEL : 0) |
                           (calibration.toeSet ? SETTINGS_POSE_TOE : 0);
  record.neutralDeg = calibration.neutralDeg;
  record.heelDeg = calibration.heelDeg;
  record.toeDeg = calibration.toeDeg;
  record.crc = settingsCrc(&record, offsetof(SettingsRecord, crc));
  return record;
}

// Whether the fields every record version shares hold usable values. A template because
// the versions share field names but not offsets.
template <typename Record>
inline bool sharedFieldsValid(const Record& record, const SettingsBounds& bounds) {
  const bool lastLitValid = record.lastLitPattern == (uint8_t)PatternId::Flow ||
                            record.lastLitPattern == (uint8_t)PatternId::FireTrail;
  const bool neutralValid = isfinite(record.neutralDeg) &&
                            fabsf(record.neutralDeg) <= bounds.maxNeutralDeg;
  // Fused angles come from atan2, so nothing valid lies beyond half a turn.
  const bool heelValid = isfinite(record.heelDeg) && fabsf(record.heelDeg) <= 180.0f;
  const bool toeValid = isfinite(record.toeDeg) && fabsf(record.toeDeg) <= 180.0f;
  const uint8_t poses = record.calibratedPoses;
  const bool posesKnown =
      (poses & ~(SETTINGS_POSE_NEUTRAL | SETTINGS_POSE_HEEL | SETTINGS_POSE_TOE)) == 0;
  const bool bothSides = (poses & SETTINGS_POSE_HEEL) && (poses & SETTINGS_POSE_TOE);
  const bool sidesOpposite = !bothSides || signOf(record.heelDeg - record.neutralDeg) !=
                                               signOf(record.toeDeg - record.neutralDeg);
  return isPatternId(record.pattern) && lastLitValid && neutralValid && heelValid && toeValid &&
         posesKnown && sidesOpposite && record.brightness >= bounds.minBrightness &&
         record.brightness <= bounds.maxBrightness;
}

template <typename Record>
inline void readSharedFields(const Record& record, Settings& out) {
  const uint8_t poses = record.calibratedPoses;
  out.pattern = (PatternId)record.pattern;
  out.lastLitPattern = (PatternId)record.lastLitPattern;
  out.brightness = record.brightness;
  out.calibration.neutralSet = (poses & SETTINGS_POSE_NEUTRAL) != 0;
  out.calibration.neutralDeg = record.neutralDeg;
  out.calibration.heelSet = (poses & SETTINGS_POSE_HEEL) != 0;
  out.calibration.heelDeg = record.heelDeg;
  out.calibration.toeSet = (poses & SETTINGS_POSE_TOE) != 0;
  out.calibration.toeDeg = record.toeDeg;
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

  const StripLayout strip = {record.stripCount, record.stripToe, record.stripHeel};
  if (!sharedFieldsValid(record, bounds) || !stripLayoutValid(strip, bounds.maxStripPixels)) {
    return SettingsDecode::Invalid;
  }

  readSharedFields(record, out);
  out.strip = strip;
  return SettingsDecode::Ok;
}

// Checks an older record the same way. It has no layout, so `out.strip` keeps the default
// it holds on entry, and the next save rewrites flash in the current format.
inline SettingsDecode decodeSettingsV2(const SettingsRecordV2& record,
                                       const SettingsBounds& bounds, Settings& out) {
  if (record.magic != SETTINGS_MAGIC ||
      record.crc != settingsCrc(&record, offsetof(SettingsRecordV2, crc))) {
    return SettingsDecode::Corrupt;
  }
  if (record.version != SETTINGS_VERSION_V2) return SettingsDecode::Unsupported;
  if (!sharedFieldsValid(record, bounds)) return SettingsDecode::Invalid;

  readSharedFields(record, out);
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
