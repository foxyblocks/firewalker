// Native (off-hardware) tests for saved settings: include/firewalker_settings.h.
// Covers the promise that anything missing or damaged in flash falls back to the
// defaults, and that a slider burst doesn't turn into a burst of flash writes. Run
// with `pio test -e native`.
#include <math.h>
#include <string.h>
#include <unity.h>

#include "firewalker_settings.h"

using namespace Firewalker;

// A hard maximum of 64 and a soft cap of 48, so a test can place a brightness between them.
static const SettingsBounds BOUNDS = {1, 64, 160, 48};
static const StripLayout DEFAULT_STRIP = {160, 52, 132};

void setUp() {}
void tearDown() {}

static Vec3 sensorPose(float degrees) { const float a=degrees*.0174532925f; return {sinf(a),0,cosf(a)}; }
static OrientationCalibration mountedPoses(float neutral, float heel, float toe) {
  OrientationCalibration c; c.neutralSet=c.heelSet=c.toeSet=true;
  c.neutral=sensorPose(neutral); c.heel=sensorPose(heel); c.toe=sensorPose(toe); return c;
}
static Settings sampleSettings() {
  Settings settings = defaultSettings(32, DEFAULT_STRIP);
  copyPatternName(settings.pattern, "fire-trail");
  copyPatternName(settings.lastLitPattern, "fire-trail");
  settings.orientation = mountedPoses(0,-25,60);
  settings.strip = {110, 40, 90};
  return settings;
}

// Re-signs a record edited by a test, so only the field under test looks wrong.
static void reseal(SettingsRecord& record) {
  record.crc = settingsCrc(&record, offsetof(SettingsRecord, crc));
}

static void test_defaults_are_rainbow_pool_and_uncalibrated() {
  const Settings settings = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", settings.pattern);
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", settings.lastLitPattern);
  TEST_ASSERT_EQUAL(16, settings.brightness);
  TEST_ASSERT_FALSE(orientationReport(settings.orientation).neutralSet);
  TEST_ASSERT_FALSE(orientationReport(settings.orientation).heelSet);
  TEST_ASSERT_FALSE(orientationReport(settings.orientation).toeSet);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, orientationReport(settings.orientation).neutralDeg);
  TEST_ASSERT_EQUAL_UINT16(160, settings.strip.count);
}

static void test_round_trip_keeps_every_field() {
  const SettingsRecord record = encodeSettings(sampleSettings());
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(record, BOUNDS, out));
  TEST_ASSERT_EQUAL_STRING("fire-trail", out.pattern);
  TEST_ASSERT_EQUAL_STRING("fire-trail", out.lastLitPattern);
  TEST_ASSERT_EQUAL(32, out.brightness);
  TEST_ASSERT_TRUE(orientationReport(out.orientation).neutralSet);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, orientationReport(out.orientation).neutralDeg);
  TEST_ASSERT_TRUE(orientationReport(out.orientation).heelSet);
  TEST_ASSERT_EQUAL_FLOAT(-25.0f, orientationReport(out.orientation).heelDeg);
  TEST_ASSERT_TRUE(orientationReport(out.orientation).toeSet);
  TEST_ASSERT_EQUAL_FLOAT(60.0f, orientationReport(out.orientation).toeDeg);
  TEST_ASSERT_EQUAL_UINT16(110, out.strip.count);
  TEST_ASSERT_EQUAL_UINT16(40, out.strip.toe);
  TEST_ASSERT_EQUAL_UINT16(90, out.strip.heel);
}

static void test_off_round_trips_and_remembers_what_to_return_to() {
  Settings settings = sampleSettings();
  copyPatternName(settings.pattern, "off");
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(settings), BOUNDS, out));
  TEST_ASSERT_EQUAL_STRING("off", out.pattern);
  TEST_ASSERT_EQUAL_STRING("fire-trail", out.lastLitPattern);
}

static void test_flipped_bit_reads_as_corrupt_and_leaves_output_alone() {
  SettingsRecord record = encodeSettings(sampleSettings());
  record.brightness ^= 0x01;
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Corrupt, decodeSettings(record, BOUNDS, out));
  TEST_ASSERT_EQUAL(16, out.brightness);
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", out.pattern);
}

static void test_an_uploaded_recipes_name_round_trips() {
  Settings settings = sampleSettings();
  copyPatternName(settings.pattern, "abcdefghijkl");
  copyPatternName(settings.lastLitPattern, "rainbow-pool");
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(settings), BOUNDS, out));
  TEST_ASSERT_EQUAL_STRING("abcdefghijkl", out.pattern);
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", out.lastLitPattern);
}

static void test_wrong_magic_reads_as_corrupt() {
  SettingsRecord record = encodeSettings(sampleSettings());
  record.magic = 0x12345678;
  reseal(record);
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Corrupt, decodeSettings(record, BOUNDS, out));
}

static void test_other_version_reads_as_unsupported() {
  SettingsRecord record = encodeSettings(sampleSettings());
  record.version = SETTINGS_VERSION + 1;
  reseal(record);
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Unsupported, decodeSettings(record, BOUNDS, out));
}

// A bad name is no reason to lose a boot's poses and strip layout.
static void test_a_garbled_name_reads_as_the_default_and_keeps_the_rest() {
  SettingsRecord record = encodeSettings(sampleSettings());
  strcpy(record.pattern, "NOT A NAME");
  memset(record.lastLitPattern, 'x', sizeof(record.lastLitPattern));  // not even terminated
  reseal(record);
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(record, BOUNDS, out));
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", out.pattern);
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", out.lastLitPattern);
  TEST_ASSERT_EQUAL(32, out.brightness);
  TEST_ASSERT_EQUAL_FLOAT(-25.0f, orientationReport(out.orientation).heelDeg);
  TEST_ASSERT_EQUAL_UINT16(110, out.strip.count);
}

static void test_off_is_not_a_pattern_to_return_to() {
  SettingsRecord record = encodeSettings(sampleSettings());
  strcpy(record.lastLitPattern, "off");
  reseal(record);
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(record, BOUNDS, out));
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", out.lastLitPattern);
}

static void test_brightness_outside_the_build_limits_reads_as_invalid() {
  Settings tooBright = sampleSettings();
  tooBright.brightness = 200;
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(tooBright), BOUNDS, out));

  Settings tooDim = sampleSettings();
  tooDim.brightness = 0;
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(tooDim), BOUNDS, out));
}

static void test_unusable_neutral_offset_reads_as_invalid() {
  Settings out = defaultSettings(16, DEFAULT_STRIP);

  Settings tooFar = sampleSettings();
  tooFar.orientation.neutral = {};
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(tooFar), BOUNDS, out));

  Settings notANumber = sampleSettings();
  notANumber.orientation.neutral.x = NAN;
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(notANumber), BOUNDS, out));
}

static void test_a_vertical_mounts_poses_survive_a_restart() {
  Settings vertical = sampleSettings();
  vertical.orientation = mountedPoses(90,65,120);
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(vertical), BOUNDS, out));
  TEST_ASSERT_EQUAL_FLOAT(0.0f, orientationReport(out.orientation).neutralDeg);
  TEST_ASSERT_FLOAT_WITHIN(.001f, -25.0f, orientationReport(out.orientation).heelDeg);
  TEST_ASSERT_FLOAT_WITHIN(.001f, 30.0f, orientationReport(out.orientation).toeDeg);
}

static void test_cleared_poses_stay_cleared_after_a_restart_without_resetting_other_settings() {
  const CalibrationClear targets[] = {CalibrationClear::Heel, CalibrationClear::Toe, CalibrationClear::All};
  for (CalibrationClear target : targets) {
    Settings settings = sampleSettings();
    const Settings before = settings;
    OrientationCalibrator calibrator({2000, 500, 50, 8.0f}, {30.0f, 3.0f, 10.0f, 30.0f});
    TEST_ASSERT_NULL(calibrator.clear(target, settings.orientation));
    Settings out = defaultSettings(16, DEFAULT_STRIP);
    TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(settings), BOUNDS, out));
    TEST_ASSERT_EQUAL(target != CalibrationClear::All, orientationReport(out.orientation).neutralSet);
    TEST_ASSERT_EQUAL(target == CalibrationClear::Toe, orientationReport(out.orientation).heelSet);
    TEST_ASSERT_EQUAL(target == CalibrationClear::Heel, orientationReport(out.orientation).toeSet);
    TEST_ASSERT_EQUAL_STRING(before.pattern, out.pattern);
    TEST_ASSERT_EQUAL(before.brightness, out.brightness);
    TEST_ASSERT_EQUAL(before.strip.count, out.strip.count);
    TEST_ASSERT_EQUAL(before.strip.toe, out.strip.toe);
    TEST_ASSERT_EQUAL(before.strip.heel, out.strip.heel);
    TEST_ASSERT_EQUAL(before.audioNoiseFloor, out.audioNoiseFloor);
    TEST_ASSERT_EQUAL(before.audioSensitivity, out.audioSensitivity);
  }
}

static void test_poses_across_the_angle_boundary_survive_a_restart() {
  const float directions[] = {-1.0f, 1.0f};
  for (float direction : directions) {
    Settings inverted = sampleSettings();
    inverted.orientation = mountedPoses(direction*179, direction*154, -direction*151);
    Settings out = defaultSettings(16, DEFAULT_STRIP);
    TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(inverted), BOUNDS, out));
    TEST_ASSERT_FLOAT_WITHIN(0.001f, 30.0f, orientationDegrees(out.orientation.toe, out.orientation));

    // Both poses on the same physical side must still be rejected after wrapping.
    inverted.orientation.heel = sensorPose(-direction*161);
    TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(inverted), BOUNDS, out));
  }
}

static void test_unusable_heel_or_toe_pose_reads_as_invalid() {
  Settings out = defaultSettings(16, DEFAULT_STRIP);

  Settings notANumber = sampleSettings();
  notANumber.orientation.toe.x = NAN;
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(notANumber), BOUNDS, out));

  Settings pastHalfATurn = sampleSettings();
  pastHalfATurn.orientation.heel = {};
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(pastHalfATurn), BOUNDS, out));

  Settings sameSide = sampleSettings();
  sameSide.orientation.heel = sensorPose(20);
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(sameSide), BOUNDS, out));
}

static void test_a_steep_toe_pose_round_trips() {
  Settings steep = sampleSettings();
  steep.orientation.toe = sensorPose(70);
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(steep), BOUNDS, out));
  TEST_ASSERT_EQUAL_FLOAT(70.0f, orientationReport(out.orientation).toeDeg);
}

static void test_a_backward_mounts_poses_round_trip() {
  Settings backward = sampleSettings();
  backward.orientation = mountedPoses(0,20,-20);
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(backward), BOUNDS, out));
  TEST_ASSERT_FLOAT_WITHIN(.001f, 20.0f, orientationReport(out.orientation).toeDeg);
}

static void test_a_mirrored_strip_layout_round_trips() {
  Settings mirrored = sampleSettings();
  mirrored.strip = {110, 90, 40};
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(mirrored), BOUNDS, out));
  TEST_ASSERT_EQUAL_UINT16(90, out.strip.toe);
  TEST_ASSERT_EQUAL_UINT16(40, out.strip.heel);
}

static void test_unusable_strip_layout_reads_as_invalid() {
  const StripLayout unusable[] = {
      {161, 52, 132},  // more pixels than this build can drive
      {1, 0, 0},       // too short for a toe and a heel
      {110, 40, 40},   // toe and heel on one pixel
      {110, 110, 40},  // toe past the end
      {110, 40, 110},  // heel past the end
  };
  for (const StripLayout& layout : unusable) {
    Settings settings = sampleSettings();
    settings.strip = layout;
    Settings out = defaultSettings(16, DEFAULT_STRIP);
    TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(settings), BOUNDS, out));
    TEST_ASSERT_EQUAL_UINT16(160, out.strip.count);
  }
}

// ── Records saved when patterns were numbered ───────────────────────────

static SettingsRecordV3 sampleV3Record(uint8_t pattern, uint8_t lastLit) {
  SettingsRecordV3 record;
  memset(&record, 0, sizeof(record));
  record.magic = SETTINGS_MAGIC;
  record.version = 3;
  record.pattern = pattern;
  record.lastLitPattern = lastLit;
  record.brightness = 24;
  record.calibratedPoses = SETTINGS_POSE_NEUTRAL | SETTINGS_POSE_HEEL | SETTINGS_POSE_TOE;
  record.stripCount = 107;
  record.stripToe = 72;
  record.stripHeel = 19;
  record.neutralDeg = 1.5f;
  record.heelDeg = -18.0f;
  record.toeDeg = 34.0f;
  record.crc = settingsCrc(&record, offsetof(SettingsRecordV3, crc));
  return record;
}

static void test_v3_record_keeps_everything_and_turns_numbers_into_names() {
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettingsV3(sampleV3Record(2, 2), BOUNDS, out));
  TEST_ASSERT_EQUAL_STRING("fire-trail", out.pattern);
  TEST_ASSERT_EQUAL_STRING("fire-trail", out.lastLitPattern);
  TEST_ASSERT_EQUAL(24, out.brightness);
  TEST_ASSERT_FALSE(orientationReport(out.orientation).neutralSet);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, orientationReport(out.orientation).neutralDeg);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, orientationReport(out.orientation).heelDeg);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, orientationReport(out.orientation).toeDeg);
  TEST_ASSERT_EQUAL_UINT16(107, out.strip.count);
  TEST_ASSERT_EQUAL_UINT16(72, out.strip.toe);
  TEST_ASSERT_EQUAL_UINT16(19, out.strip.heel);

  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettingsV3(sampleV3Record(1, 1), BOUNDS, out));
  TEST_ASSERT_EQUAL_STRING("flow", out.pattern);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettingsV3(sampleV3Record(3, 2), BOUNDS, out));
  TEST_ASSERT_EQUAL_STRING("off", out.pattern);
  TEST_ASSERT_EQUAL_STRING("fire-trail", out.lastLitPattern);
}

static void test_a_v3_record_rewrites_as_the_current_version() {
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettingsV3(sampleV3Record(3, 2), BOUNDS, out));
  Settings again = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(out), BOUNDS, again));
  TEST_ASSERT_EQUAL_STRING("off", again.pattern);
  TEST_ASSERT_EQUAL_STRING("fire-trail", again.lastLitPattern);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, orientationReport(again.orientation).toeDeg);
  TEST_ASSERT_EQUAL_UINT16(107, again.strip.count);
}

static void test_a_v3_record_with_an_impossible_pattern_number_is_invalid() {
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettingsV3(sampleV3Record(99, 1), BOUNDS, out));
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettingsV3(sampleV3Record(1, 3), BOUNDS, out));
}

static void test_a_damaged_v3_record_is_corrupt_and_leaves_output_alone() {
  SettingsRecordV3 record = sampleV3Record(2, 2);
  record.brightness ^= 0x01;
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Corrupt, decodeSettingsV3(record, BOUNDS, out));
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", out.pattern);
}

// ── Records saved before the strip layout was a setting ─────────────────

static SettingsRecordV2 sampleV2Record() {
  SettingsRecordV2 record;
  memset(&record, 0, sizeof(record));
  record.magic = SETTINGS_MAGIC;
  record.version = 2;
  record.pattern = LEGACY_PATTERN_FIRE_TRAIL;
  record.lastLitPattern = LEGACY_PATTERN_FIRE_TRAIL;
  record.brightness = 40;
  record.calibratedPoses = SETTINGS_POSE_NEUTRAL | SETTINGS_POSE_HEEL | SETTINGS_POSE_TOE;
  record.neutralDeg = 1.5f;
  record.heelDeg = -18.0f;
  record.toeDeg = 34.0f;
  record.crc = settingsCrc(&record, offsetof(SettingsRecordV2, crc));
  return record;
}

static void test_v2_record_keeps_its_settings_and_takes_the_default_strip() {
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettingsV2(sampleV2Record(), BOUNDS, out));
  TEST_ASSERT_EQUAL_STRING("fire-trail", out.pattern);
  TEST_ASSERT_EQUAL(40, out.brightness);
  TEST_ASSERT_FALSE(orientationReport(out.orientation).neutralSet);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, orientationReport(out.orientation).neutralDeg);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, orientationReport(out.orientation).heelDeg);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, orientationReport(out.orientation).toeDeg);
  TEST_ASSERT_EQUAL_UINT16(160, out.strip.count);
  TEST_ASSERT_EQUAL_UINT16(52, out.strip.toe);
  TEST_ASSERT_EQUAL_UINT16(132, out.strip.heel);
}

static void test_damaged_v2_record_is_corrupt_and_leaves_output_alone() {
  SettingsRecordV2 record = sampleV2Record();
  record.brightness ^= 0x01;
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Corrupt, decodeSettingsV2(record, BOUNDS, out));
  TEST_ASSERT_EQUAL(16, out.brightness);
}

static void test_v2_record_with_bad_values_is_invalid() {
  SettingsRecordV2 record = sampleV2Record();
  record.brightness = 200;
  record.crc = settingsCrc(&record, offsetof(SettingsRecordV2, crc));
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettingsV2(record, BOUNDS, out));
}

static void test_a_record_of_another_version_is_not_read_as_v2() {
  SettingsRecordV2 record = sampleV2Record();
  record.version = 1;
  record.crc = settingsCrc(&record, offsetof(SettingsRecordV2, crc));
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Unsupported, decodeSettingsV2(record, BOUNDS, out));
}

static void test_scheduler_stays_quiet_with_nothing_to_save() {
  SaveScheduler scheduler(1000, 5000);
  TEST_ASSERT_FALSE(scheduler.dirty());
  TEST_ASSERT_FALSE(scheduler.due(100000));
}

static void test_scheduler_saves_once_changes_pause() {
  SaveScheduler scheduler(1000, 5000);
  scheduler.markChanged(100);
  TEST_ASSERT_FALSE(scheduler.due(1099));
  TEST_ASSERT_TRUE(scheduler.due(1100));
  scheduler.markSaved();
  TEST_ASSERT_FALSE(scheduler.due(2000));
}

static void test_scheduler_is_not_due_when_now_predates_the_change() {
  SaveScheduler scheduler(1000, 5000);
  scheduler.markChanged(5000);
  TEST_ASSERT_FALSE(scheduler.due(4999));
}

static void test_slider_burst_becomes_one_save() {
  SaveScheduler scheduler(1000, 5000);
  int saves = 0;
  // 30 slider updates over 1.5 s, then the user lets go.
  for (uint32_t t = 0; t < 4000; t += 50) {
    if (t < 1500) scheduler.markChanged(t);
    if (scheduler.due(t)) {
      saves++;
      scheduler.markSaved();
    }
  }
  TEST_ASSERT_EQUAL(1, saves);
}

static void test_endless_changes_still_save_by_the_longest_delay() {
  SaveScheduler scheduler(1000, 5000);
  uint32_t savedAt = 0;
  for (uint32_t t = 0; t < 8000 && savedAt == 0; t += 100) {
    scheduler.markChanged(t);
    if (scheduler.due(t)) savedAt = t;
  }
  TEST_ASSERT_EQUAL(5000, savedAt);
}

// ── The soft brightness cap ─────────────────────────────────────────────

static void test_a_new_boot_starts_with_the_soft_cap_on() {
  TEST_ASSERT_TRUE(defaultSettings(16, DEFAULT_STRIP).capped);
}

static void test_turning_the_cap_off_survives_a_save() {
  Settings uncapped = sampleSettings();
  uncapped.capped = false;
  uncapped.brightness = 60;  // over the soft cap of 48, under the hard maximum of 64
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(uncapped), BOUNDS, out));
  TEST_ASSERT_FALSE(out.capped);
  TEST_ASSERT_EQUAL(60, out.brightness);
}

// Version 4 records saved before the cap existed hold zero where its flag now sits. They have to
// come back capped, with their poses and strip layout intact.
static void test_a_record_saved_before_the_cap_existed_loads_capped() {
  Settings uncapped = sampleSettings();
  uncapped.capped = false;
  SettingsRecord record = encodeSettings(uncapped);
  record.flags = 0;
  reseal(record);
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  out.capped = false;
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(record, BOUNDS, out));
  TEST_ASSERT_TRUE(out.capped);
  TEST_ASSERT_TRUE(orientationReport(out.orientation).toeSet);
  TEST_ASSERT_EQUAL_FLOAT(60.0f, orientationReport(out.orientation).toeDeg);
  TEST_ASSERT_EQUAL_UINT16(110, out.strip.count);
}

static void test_a_capped_boot_writes_no_flag() {
  TEST_ASSERT_EQUAL_UINT8(0, encodeSettings(sampleSettings()).flags);
}

static void test_flags_a_newer_firmware_might_add_are_ignored() {
  SettingsRecord record = encodeSettings(sampleSettings());
  record.flags |= 0x80;
  reseal(record);
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(record, BOUNDS, out));
  TEST_ASSERT_TRUE(out.capped);
}

static void test_a_capped_record_over_the_cap_loads_at_the_cap() {
  Settings bright = sampleSettings();
  bright.brightness = 60;
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(bright), BOUNDS, out));
  TEST_ASSERT_TRUE(out.capped);
  TEST_ASSERT_EQUAL(48, out.brightness);
}

// Firmware before the soft cap had a fixed maximum, so whatever it saved was capped.
static void test_older_records_load_capped() {
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  out.capped = false;
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettingsV3(sampleV3Record(2, 2), BOUNDS, out));
  TEST_ASSERT_TRUE(out.capped);

  out.capped = false;
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettingsV2(sampleV2Record(), BOUNDS, out));
  TEST_ASSERT_TRUE(out.capped);
}

static void test_the_ceiling_follows_the_cap() {
  Settings settings = sampleSettings();
  TEST_ASSERT_EQUAL(48, brightnessCeiling(settings, BOUNDS));
  settings.capped = false;
  TEST_ASSERT_EQUAL(64, brightnessCeiling(settings, BOUNDS));
}

static void test_turning_the_cap_on_pulls_brightness_down_to_it() {
  Settings settings = sampleSettings();
  settings.capped = false;
  settings.brightness = 60;
  TEST_ASSERT_TRUE(setBrightnessCap(settings, true, BOUNDS));
  TEST_ASSERT_TRUE(settings.capped);
  TEST_ASSERT_EQUAL(48, settings.brightness);
}

static void test_turning_the_cap_off_keeps_the_brightness() {
  Settings settings = sampleSettings();
  TEST_ASSERT_TRUE(setBrightnessCap(settings, false, BOUNDS));
  TEST_ASSERT_FALSE(settings.capped);
  TEST_ASSERT_EQUAL(32, settings.brightness);
  // Asking for the state it's already in changes nothing, so there's nothing to save.
  TEST_ASSERT_FALSE(setBrightnessCap(settings, false, BOUNDS));
}

static void test_audio_settings_round_trip_and_v4_upgrade_requires_new_poses() {
  Settings source = sampleSettings();
  source.audioNoiseFloor = 13;
  source.audioSensitivity = 42;
  SettingsRecord record = encodeSettings(source);
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(record, BOUNDS, out));
  TEST_ASSERT_EQUAL_UINT8(13, out.audioNoiseFloor);
  TEST_ASSERT_EQUAL_UINT8(42, out.audioSensitivity);

  // Version 4 used these bytes as reserved padding, so ignore them during upgrade.
  SettingsRecordV5 legacy{};
  memcpy(&legacy, &record, offsetof(SettingsRecordV5, crc));
  legacy.version = SETTINGS_VERSION_V4;
  legacy.audioNoiseFloor = 0;
  legacy.audioSensitivity = 255;
  legacy.crc = settingsCrc(&legacy, offsetof(SettingsRecordV5, crc));
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettingsV5(legacy, BOUNDS, out));
  TEST_ASSERT_EQUAL_UINT8(AUDIO_DEFAULT_NOISE_FLOOR, out.audioNoiseFloor);
  TEST_ASSERT_EQUAL_UINT8(AUDIO_DEFAULT_SENSITIVITY, out.audioSensitivity);
  TEST_ASSERT_FALSE(orientationReport(out.orientation).neutralSet);
  TEST_ASSERT_EQUAL_UINT16(source.strip.toe, out.strip.toe);
  TEST_ASSERT_EQUAL_STRING(source.pattern, out.pattern);

  legacy.version = SETTINGS_VERSION_V5;
  legacy.audioNoiseFloor = 0;
  legacy.crc = settingsCrc(&legacy, offsetof(SettingsRecordV5, crc));
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettingsV5(legacy, BOUNDS, out));
  legacy.audioNoiseFloor = 13;
  legacy.audioSensitivity = 101;
  legacy.crc = settingsCrc(&legacy, offsetof(SettingsRecordV5, crc));
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettingsV5(legacy, BOUNDS, out));
}

// The cap flag and the microphone tuning each have their own spare bytes, so both survive a save,
// and a version 5 record saved before the cap existed keeps its tuning and comes back capped.
static void test_mic_tuning_and_the_cap_flag_keep_their_own_bytes() {
  Settings source = sampleSettings();
  source.capped = false;
  source.brightness = 60;
  source.audioNoiseFloor = 13;
  source.audioSensitivity = 42;
  SettingsRecord record = encodeSettings(source);
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(record, BOUNDS, out));
  TEST_ASSERT_FALSE(out.capped);
  TEST_ASSERT_EQUAL(60, out.brightness);
  TEST_ASSERT_EQUAL_UINT8(13, out.audioNoiseFloor);
  TEST_ASSERT_EQUAL_UINT8(42, out.audioSensitivity);

  record.flags = 0;
  reseal(record);
  out = defaultSettings(16, DEFAULT_STRIP);
  out.capped = false;
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(record, BOUNDS, out));
  TEST_ASSERT_TRUE(out.capped);
  TEST_ASSERT_EQUAL(48, out.brightness);
  TEST_ASSERT_EQUAL_UINT8(13, out.audioNoiseFloor);
  TEST_ASSERT_EQUAL_UINT8(42, out.audioSensitivity);
  TEST_ASSERT_EQUAL_UINT16(110, out.strip.count);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_audio_settings_round_trip_and_v4_upgrade_requires_new_poses);
  RUN_TEST(test_mic_tuning_and_the_cap_flag_keep_their_own_bytes);
  RUN_TEST(test_defaults_are_rainbow_pool_and_uncalibrated);
  RUN_TEST(test_round_trip_keeps_every_field);
  RUN_TEST(test_off_round_trips_and_remembers_what_to_return_to);
  RUN_TEST(test_flipped_bit_reads_as_corrupt_and_leaves_output_alone);
  RUN_TEST(test_wrong_magic_reads_as_corrupt);
  RUN_TEST(test_other_version_reads_as_unsupported);
  RUN_TEST(test_an_uploaded_recipes_name_round_trips);
  RUN_TEST(test_a_garbled_name_reads_as_the_default_and_keeps_the_rest);
  RUN_TEST(test_off_is_not_a_pattern_to_return_to);
  RUN_TEST(test_brightness_outside_the_build_limits_reads_as_invalid);
  RUN_TEST(test_unusable_neutral_offset_reads_as_invalid);
  RUN_TEST(test_a_vertical_mounts_poses_survive_a_restart);
  RUN_TEST(test_cleared_poses_stay_cleared_after_a_restart_without_resetting_other_settings);
  RUN_TEST(test_poses_across_the_angle_boundary_survive_a_restart);
  RUN_TEST(test_unusable_heel_or_toe_pose_reads_as_invalid);
  RUN_TEST(test_a_steep_toe_pose_round_trips);
  RUN_TEST(test_a_backward_mounts_poses_round_trip);
  RUN_TEST(test_a_mirrored_strip_layout_round_trips);
  RUN_TEST(test_unusable_strip_layout_reads_as_invalid);
  RUN_TEST(test_v3_record_keeps_everything_and_turns_numbers_into_names);
  RUN_TEST(test_a_v3_record_rewrites_as_the_current_version);
  RUN_TEST(test_a_v3_record_with_an_impossible_pattern_number_is_invalid);
  RUN_TEST(test_a_damaged_v3_record_is_corrupt_and_leaves_output_alone);
  RUN_TEST(test_v2_record_keeps_its_settings_and_takes_the_default_strip);
  RUN_TEST(test_damaged_v2_record_is_corrupt_and_leaves_output_alone);
  RUN_TEST(test_v2_record_with_bad_values_is_invalid);
  RUN_TEST(test_a_record_of_another_version_is_not_read_as_v2);
  RUN_TEST(test_scheduler_stays_quiet_with_nothing_to_save);
  RUN_TEST(test_scheduler_saves_once_changes_pause);
  RUN_TEST(test_scheduler_is_not_due_when_now_predates_the_change);
  RUN_TEST(test_slider_burst_becomes_one_save);
  RUN_TEST(test_endless_changes_still_save_by_the_longest_delay);
  RUN_TEST(test_a_new_boot_starts_with_the_soft_cap_on);
  RUN_TEST(test_turning_the_cap_off_survives_a_save);
  RUN_TEST(test_a_record_saved_before_the_cap_existed_loads_capped);
  RUN_TEST(test_a_capped_boot_writes_no_flag);
  RUN_TEST(test_flags_a_newer_firmware_might_add_are_ignored);
  RUN_TEST(test_a_capped_record_over_the_cap_loads_at_the_cap);
  RUN_TEST(test_older_records_load_capped);
  RUN_TEST(test_the_ceiling_follows_the_cap);
  RUN_TEST(test_turning_the_cap_on_pulls_brightness_down_to_it);
  RUN_TEST(test_turning_the_cap_off_keeps_the_brightness);
  return UNITY_END();
}
