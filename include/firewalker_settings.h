#pragma once

// Pure settings logic: what each controller remembers across power cycles (its
// pattern, brightness, soft brightness cap, calibrated poses, strip layout, and microphone
// tuning), how
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
#include "firewalker_angles.h"
#include "firewalker_orientation.h"
#include "firewalker_strip_map.h"

namespace Firewalker {

// A pattern is known by its name everywhere, including in flash, because the list of patterns
// changes as recipes are uploaded and deleted. A name means the same thing after any firmware update.
constexpr size_t PATTERN_NAME_MAX_LENGTH = 12;
constexpr size_t PATTERN_NAME_SIZE = PATTERN_NAME_MAX_LENGTH + 1;
constexpr const char* PATTERN_OFF = "off";
// What a boot shows first, and what it falls back to when a saved name no longer exists.
constexpr const char* PATTERN_DEFAULT = "rainbow-pool";

// Whether a name is spelled legally: 1 to 12 characters, a lowercase letter and then lowercase
// letters, digits, or hyphens. Whether a pattern by that name exists is a separate question.
inline bool patternNameValid(const char* name) {
  const size_t length = strlen(name);
  if (length == 0 || length > PATTERN_NAME_MAX_LENGTH) return false;
  if (name[0] < 'a' || name[0] > 'z') return false;
  for (size_t i = 1; i < length; i++) {
    const char c = name[i];
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return false;
  }
  return true;
}

// Copies a name known to fit. An output buffer always ends up a whole, terminated string.
inline void copyPatternName(char* out, const char* name) {
  strncpy(out, name, PATTERN_NAME_SIZE - 1);
  out[PATTERN_NAME_SIZE - 1] = '\0';
}

constexpr uint8_t AUDIO_DEFAULT_NOISE_FLOOR = 8;
constexpr uint8_t AUDIO_DEFAULT_SENSITIVITY = 65;

struct Settings {
  char pattern[PATTERN_NAME_SIZE];
  // The pattern turning back on returns to. Never off.
  char lastLitPattern[PATTERN_NAME_SIZE];
  uint8_t brightness;
  // Whether the soft cap is on, holding brightness at or under SettingsBounds::softCapBrightness.
  // It keeps a USB-fed strip inside what a USB port can supply, and someone turns it off from
  // the remote to go brighter on a dedicated supply.
  bool capped;
  uint8_t audioNoiseFloor;
  uint8_t audioSensitivity;
  OrientationCalibration orientation;
  StripLayout strip;
};

struct SettingsBounds {
  uint8_t minBrightness;
  uint8_t maxBrightness;      // the most a boot accepts with its soft cap off
  uint16_t maxStripPixels;
  uint8_t softCapBrightness;  // the most a boot accepts with its soft cap on
};

// First-boot settings: rainbow-pool at the given brightness with the soft cap on, no calibrated poses,
// and the strip layout this build starts from.
inline Settings defaultSettings(uint8_t brightness, const StripLayout& strip) {
  Settings settings{};
  copyPatternName(settings.pattern, PATTERN_DEFAULT);
  copyPatternName(settings.lastLitPattern, PATTERN_DEFAULT);
  settings.brightness = brightness;
  settings.capped = true;
  settings.audioNoiseFloor = AUDIO_DEFAULT_NOISE_FLOOR;
  settings.audioSensitivity = AUDIO_DEFAULT_SENSITIVITY;
  settings.strip = strip;
  return settings;
}

// The highest brightness a boot accepts right now: the soft cap while it's on, and the hard
// maximum while it's off. With a soft cap of 96 that's 96, or 255 with the cap off.
inline uint8_t brightnessCeiling(const Settings& settings, const SettingsBounds& bounds) {
  return settings.capped ? bounds.softCapBrightness : bounds.maxBrightness;
}

// Turns the soft cap on or off. Turning it on brings a brightness over the cap down to it, so the
// cap holds from that moment: 200 becomes 96. Turning it off leaves the brightness where it is.
// Returns whether anything changed, which is whether there's anything to save.
inline bool setBrightnessCap(Settings& settings, bool capped, const SettingsBounds& bounds) {
  const uint8_t before = settings.brightness;
  const bool wasCapped = settings.capped;
  settings.capped = capped;
  if (capped && settings.brightness > bounds.softCapBrightness) {
    settings.brightness = bounds.softCapBrightness;
  }
  return settings.capped != wasCapped || settings.brightness != before;
}

// The fixed-size record stored in flash. The magic number and version let a future
// firmware recognize this layout, and the CRC catches a damaged or partial record.
struct SettingsRecordV5 {
  uint32_t magic;
  uint16_t version;
  uint8_t brightness;
  uint8_t calibratedPoses;  // the SETTINGS_POSE_* bits
  uint16_t stripCount;
  uint16_t stripToe;
  uint16_t stripHeel;
  uint8_t flags;  // the SETTINGS_FLAG_* bits
  uint8_t reserved;
  float neutralDeg;
  float heelDeg;
  float toeDeg;
  char pattern[PATTERN_NAME_SIZE];
  char lastLitPattern[PATTERN_NAME_SIZE];
  uint8_t audioNoiseFloor;  // version 5; these two bytes are reserved in version 4
  uint8_t audioSensitivity;
  uint32_t crc;
};

// Version 6 stores the mounting reference as 3D gravity vectors. Scalar pose
// angles remain report metadata; motion uses only these vectors.
struct SettingsRecord {
  uint32_t magic;
  uint16_t version;
  uint8_t brightness;
  uint8_t calibratedPoses;  // the SETTINGS_POSE_* bits
  uint16_t stripCount;
  uint16_t stripToe;
  uint16_t stripHeel;
  uint8_t flags;  // the SETTINGS_FLAG_* bits
  uint8_t reserved;
  float neutralDeg;
  float heelDeg;
  float toeDeg;
  char pattern[PATTERN_NAME_SIZE];
  char lastLitPattern[PATTERN_NAME_SIZE];
  uint8_t audioNoiseFloor;  // version 5; these two bytes are reserved in version 4
  uint8_t audioSensitivity;
  Vec3 neutralGravity;
  Vec3 heelGravity;
  Vec3 toeGravity;
  uint32_t crc;
};

// The record boots saved when patterns were numbered. Flash still holds one of these on a boot's
// first start after that update, so it's read rather than discarded: otherwise updating the firmware
// would throw away that boot's calibrated poses and strip layout.
struct SettingsRecordV3 {
  uint32_t magic;
  uint16_t version;
  uint8_t pattern;
  uint8_t lastLitPattern;
  uint8_t brightness;
  uint8_t calibratedPoses;
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
// already in flash. Version 5 uses version 4's two reserved end bytes for audio
// tuning; the overall record size and the stored pose/layout offsets stay fixed.
static_assert(sizeof(SettingsRecordV2) == 28, "SettingsRecordV2 must match saved records");
static_assert(sizeof(SettingsRecordV3) == 32, "SettingsRecordV3 must match saved records");
static_assert(sizeof(SettingsRecordV5) == 60, "V4/V5 records stay readable");
static_assert(sizeof(SettingsRecord) == 96, "A new record layout needs a new version");

constexpr uint32_t SETTINGS_MAGIC = 0x46574C4B;  // "FWLK"
constexpr uint16_t SETTINGS_VERSION = 6;
constexpr uint16_t SETTINGS_VERSION_V5 = 5;
constexpr uint16_t SETTINGS_VERSION_V4 = 4;
constexpr uint16_t SETTINGS_VERSION_V3 = 3;
constexpr uint16_t SETTINGS_VERSION_V2 = 2;
// How version 2 and 3 records stored a pattern.
constexpr uint8_t LEGACY_PATTERN_FLOW = 1;
constexpr uint8_t LEGACY_PATTERN_FIRE_TRAIL = 2;
constexpr uint8_t LEGACY_PATTERN_OFF = 3;
constexpr uint8_t SETTINGS_POSE_NEUTRAL = 1 << 0;
constexpr uint8_t SETTINGS_POSE_HEEL = 1 << 1;
constexpr uint8_t SETTINGS_POSE_TOE = 1 << 2;
// Set when the soft cap is off. A clear bit means capped because records saved before the cap
// existed, version 4 or 5, hold zero here, so they load with it on. Bits this firmware doesn't
// know are ignored, so a record from a newer firmware still loads.
constexpr uint8_t SETTINGS_FLAG_UNCAPPED = 1 << 0;

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
  copyPatternName(record.pattern, settings.pattern);
  copyPatternName(record.lastLitPattern, settings.lastLitPattern);
  record.brightness = settings.brightness;
  record.audioNoiseFloor = settings.audioNoiseFloor;
  record.audioSensitivity = settings.audioSensitivity;
  record.stripCount = settings.strip.count;
  record.stripToe = settings.strip.toe;
  record.stripHeel = settings.strip.heel;
  record.flags = settings.capped ? 0 : SETTINGS_FLAG_UNCAPPED;
  const TiltCalibration calibration = orientationReport(settings.orientation);
  record.calibratedPoses = (calibration.neutralSet ? SETTINGS_POSE_NEUTRAL : 0) |
                           (calibration.heelSet ? SETTINGS_POSE_HEEL : 0) |
                           (calibration.toeSet ? SETTINGS_POSE_TOE : 0);
  record.neutralGravity = settings.orientation.neutral;
  record.heelGravity = settings.orientation.heel;
  record.toeGravity = settings.orientation.toe;
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
  // Every mounting angle is usable as neutral. This checks the stored angle's
  // representation, just like heel and toe, rather than how flat the board sits.
  const bool neutralValid = validAngleDegrees(record.neutralDeg);
  const bool heelValid = validAngleDegrees(record.heelDeg);
  const bool toeValid = validAngleDegrees(record.toeDeg);
  const uint8_t poses = record.calibratedPoses;
  const bool posesKnown =
      (poses & ~(SETTINGS_POSE_NEUTRAL | SETTINGS_POSE_HEEL | SETTINGS_POSE_TOE)) == 0;
  const bool bothSides = (poses & SETTINGS_POSE_HEEL) && (poses & SETTINGS_POSE_TOE);
  const bool sidesOpposite = !bothSides || (degreesBetween(record.heelDeg, record.neutralDeg) < 0) !=
                                               (degreesBetween(record.toeDeg, record.neutralDeg) < 0);
  return neutralValid && heelValid && toeValid && posesKnown && sidesOpposite &&
         record.brightness >= bounds.minBrightness && record.brightness <= bounds.maxBrightness;
}

template <typename Record>
inline void readSharedFields(const Record& record, Settings& out) {
  out.brightness = record.brightness;
}

// Whether an old record's pattern numbers are ones those firmwares could save.
template <typename Record>
inline bool legacyPatternsValid(const Record& record) {
  const bool patternValid = record.pattern >= LEGACY_PATTERN_FLOW && record.pattern <= LEGACY_PATTERN_OFF;
  const bool lastLitValid =
      record.lastLitPattern == LEGACY_PATTERN_FLOW || record.lastLitPattern == LEGACY_PATTERN_FIRE_TRAIL;
  return patternValid && lastLitValid;
}

inline const char* legacyPatternName(uint8_t pattern) {
  if (pattern == LEGACY_PATTERN_FIRE_TRAIL) return "fire-trail";
  if (pattern == LEGACY_PATTERN_OFF) return PATTERN_OFF;
  return "flow";
}

template <typename Record>
inline void readLegacyPatterns(const Record& record, Settings& out) {
  copyPatternName(out.pattern, legacyPatternName(record.pattern));
  copyPatternName(out.lastLitPattern, legacyPatternName(record.lastLitPattern));
}

// Holds a loaded brightness under the soft cap. A capped record can only hold a brightness over
// the cap if the cap was lowered after it was saved, and the cap still holds then.
inline void holdUnderSoftCap(Settings& out, const SettingsBounds& bounds) {
  if (out.capped && out.brightness > bounds.softCapBrightness) out.brightness = bounds.softCapBrightness;
}

// Reads a saved pattern name. A garbled one reads as the default, because a bad name is no reason to
// lose this boot's brightness, poses, and strip layout. Whether a pattern by that name still exists
// is for the caller to check: it can't be known from settings alone.
inline void readSavedPatternName(const char* saved, bool offAllowed, char* out) {
  const bool terminated = memchr(saved, '\0', PATTERN_NAME_SIZE) != nullptr;
  const bool usable = terminated && patternNameValid(saved) && (offAllowed || strcmp(saved, PATTERN_OFF) != 0);
  copyPatternName(out, usable ? saved : PATTERN_DEFAULT);
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

  if (record.version == SETTINGS_VERSION && (record.audioNoiseFloor == 0 || record.audioSensitivity > 100)) {
    return SettingsDecode::Invalid;
  }
  OrientationCalibration orientation;
  orientation.neutralSet = record.calibratedPoses & SETTINGS_POSE_NEUTRAL;
  orientation.heelSet = record.calibratedPoses & SETTINGS_POSE_HEEL;
  orientation.toeSet = record.calibratedPoses & SETTINGS_POSE_TOE;
  orientation.neutral = record.neutralGravity;
  orientation.heel = record.heelGravity;
  orientation.toe = record.toeGravity;
  if (!validOrientationCalibration(orientation)) return SettingsDecode::Invalid;
  out.audioNoiseFloor = record.version == SETTINGS_VERSION ? record.audioNoiseFloor : AUDIO_DEFAULT_NOISE_FLOOR;
  out.audioSensitivity = record.version == SETTINGS_VERSION ? record.audioSensitivity : AUDIO_DEFAULT_SENSITIVITY;

  readSharedFields(record, out);
  out.orientation = orientation;
  readSavedPatternName(record.pattern, true, out.pattern);
  readSavedPatternName(record.lastLitPattern, false, out.lastLitPattern);
  out.strip = strip;
  out.capped = (record.flags & SETTINGS_FLAG_UNCAPPED) == 0;
  holdUnderSoftCap(out, bounds);
  return SettingsDecode::Ok;
}

// Loads the scalar-pose V4/V5 format, preserving non-pose settings.
inline SettingsDecode decodeSettingsV5(const SettingsRecordV5& record,
                                     const SettingsBounds& bounds, Settings& out) {
  if (record.magic != SETTINGS_MAGIC ||
      record.crc != settingsCrc(&record, offsetof(SettingsRecordV5, crc))) {
    return SettingsDecode::Corrupt;
  }
  if (record.version != SETTINGS_VERSION_V5 && record.version != SETTINGS_VERSION_V4) return SettingsDecode::Unsupported;

  const StripLayout strip = {record.stripCount, record.stripToe, record.stripHeel};
  if (!sharedFieldsValid(record, bounds) || !stripLayoutValid(strip, bounds.maxStripPixels)) {
    return SettingsDecode::Invalid;
  }

  if (record.version == SETTINGS_VERSION_V5 && (record.audioNoiseFloor == 0 || record.audioSensitivity > 100)) {
    return SettingsDecode::Invalid;
  }
  out.audioNoiseFloor = record.version == SETTINGS_VERSION_V5 ? record.audioNoiseFloor : AUDIO_DEFAULT_NOISE_FLOOR;
  out.audioSensitivity = record.version == SETTINGS_VERSION_V5 ? record.audioSensitivity : AUDIO_DEFAULT_SENSITIVITY;
  readSharedFields(record, out);
  readSavedPatternName(record.pattern, true, out.pattern);
  readSavedPatternName(record.lastLitPattern, false, out.lastLitPattern);
  out.strip = strip;
  out.capped = (record.flags & SETTINGS_FLAG_UNCAPPED) == 0;
  holdUnderSoftCap(out, bounds);
  // Scalar angles cannot reconstruct an arbitrary 3D mount. Keep all other
  // settings, and ask for fresh held poses after the firmware update.
  out.orientation = OrientationCalibration{};
  return SettingsDecode::Ok;
}

// Checks a record from when patterns were numbered. It maps each number to its name and keeps
// everything else, and the next save rewrites flash in the current format. That firmware had a
// fixed brightness maximum, so the record loads with the soft cap on.
inline SettingsDecode decodeSettingsV3(const SettingsRecordV3& record,
                                       const SettingsBounds& bounds, Settings& out) {
  if (record.magic != SETTINGS_MAGIC ||
      record.crc != settingsCrc(&record, offsetof(SettingsRecordV3, crc))) {
    return SettingsDecode::Corrupt;
  }
  if (record.version != SETTINGS_VERSION_V3) return SettingsDecode::Unsupported;

  const StripLayout strip = {record.stripCount, record.stripToe, record.stripHeel};
  if (!sharedFieldsValid(record, bounds) || !legacyPatternsValid(record) ||
      !stripLayoutValid(strip, bounds.maxStripPixels)) {
    return SettingsDecode::Invalid;
  }

  readSharedFields(record, out);
  readLegacyPatterns(record, out);
  out.audioNoiseFloor = AUDIO_DEFAULT_NOISE_FLOOR;
  out.audioSensitivity = AUDIO_DEFAULT_SENSITIVITY;
  out.strip = strip;
  out.capped = true;
  holdUnderSoftCap(out, bounds);
  out.orientation = OrientationCalibration{};
  return SettingsDecode::Ok;
}

// Checks an older record the same way. It has no layout, so `out.strip` keeps the default
// it holds on entry, and the next save rewrites flash in the current format. Like version 3,
// it loads with the soft cap on.
inline SettingsDecode decodeSettingsV2(const SettingsRecordV2& record,
                                       const SettingsBounds& bounds, Settings& out) {
  if (record.magic != SETTINGS_MAGIC ||
      record.crc != settingsCrc(&record, offsetof(SettingsRecordV2, crc))) {
    return SettingsDecode::Corrupt;
  }
  if (record.version != SETTINGS_VERSION_V2) return SettingsDecode::Unsupported;
  if (!sharedFieldsValid(record, bounds) || !legacyPatternsValid(record)) return SettingsDecode::Invalid;

  readSharedFields(record, out);
  readLegacyPatterns(record, out);
  out.capped = true;
  holdUnderSoftCap(out, bounds);
  out.audioNoiseFloor = AUDIO_DEFAULT_NOISE_FLOOR;
  out.audioSensitivity = AUDIO_DEFAULT_SENSITIVITY;
  out.orientation = OrientationCalibration{};
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
