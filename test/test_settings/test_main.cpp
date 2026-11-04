// Native (off-hardware) tests for saved settings: include/firewalker_settings.h.
// Covers the promise that anything missing or damaged in flash falls back to the
// defaults, and that a slider burst doesn't turn into a burst of flash writes. Run
// with `pio test -e native`.
#include <math.h>
#include <string.h>
#include <unity.h>

#include "firewalker_settings.h"

using namespace Firewalker;

static const SettingsBounds BOUNDS = {1, 64, 45.0f, 160};
static const StripLayout DEFAULT_STRIP = {160, 52, 132};

void setUp() {}
void tearDown() {}

static Settings sampleSettings() {
  Settings settings = defaultSettings(32, DEFAULT_STRIP);
  settings.pattern = PatternId::FireTrail;
  settings.lastLitPattern = PatternId::FireTrail;
  settings.calibration.neutralSet = true;
  settings.calibration.neutralDeg = -3.5f;
  settings.calibration.heelSet = true;
  settings.calibration.heelDeg = -25.0f;
  settings.calibration.toeSet = true;
  settings.calibration.toeDeg = 60.0f;
  settings.strip = {110, 40, 90};
  return settings;
}

// Re-signs a record edited by a test, so only the field under test looks wrong.
static void reseal(SettingsRecord& record) {
  record.crc = settingsCrc(&record, offsetof(SettingsRecord, crc));
}

static void test_defaults_are_flow_and_uncalibrated() {
  const Settings settings = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(PatternId::Flow, settings.pattern);
  TEST_ASSERT_EQUAL(16, settings.brightness);
  TEST_ASSERT_FALSE(settings.calibration.neutralSet);
  TEST_ASSERT_FALSE(settings.calibration.heelSet);
  TEST_ASSERT_FALSE(settings.calibration.toeSet);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, settings.calibration.neutralDeg);
  TEST_ASSERT_EQUAL_UINT16(160, settings.strip.count);
}

static void test_round_trip_keeps_every_field() {
  const SettingsRecord record = encodeSettings(sampleSettings());
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(record, BOUNDS, out));
  TEST_ASSERT_EQUAL(PatternId::FireTrail, out.pattern);
  TEST_ASSERT_EQUAL(PatternId::FireTrail, out.lastLitPattern);
  TEST_ASSERT_EQUAL(32, out.brightness);
  TEST_ASSERT_TRUE(out.calibration.neutralSet);
  TEST_ASSERT_EQUAL_FLOAT(-3.5f, out.calibration.neutralDeg);
  TEST_ASSERT_TRUE(out.calibration.heelSet);
  TEST_ASSERT_EQUAL_FLOAT(-25.0f, out.calibration.heelDeg);
  TEST_ASSERT_TRUE(out.calibration.toeSet);
  TEST_ASSERT_EQUAL_FLOAT(60.0f, out.calibration.toeDeg);
  TEST_ASSERT_EQUAL_UINT16(110, out.strip.count);
  TEST_ASSERT_EQUAL_UINT16(40, out.strip.toe);
  TEST_ASSERT_EQUAL_UINT16(90, out.strip.heel);
}

static void test_off_round_trips_and_remembers_what_to_return_to() {
  Settings settings = sampleSettings();
  settings.pattern = PatternId::Off;
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(settings), BOUNDS, out));
  TEST_ASSERT_EQUAL(PatternId::Off, out.pattern);
  TEST_ASSERT_EQUAL(PatternId::FireTrail, out.lastLitPattern);
}

static void test_flipped_bit_reads_as_corrupt_and_leaves_output_alone() {
  SettingsRecord record = encodeSettings(sampleSettings());
  record.brightness ^= 0x01;
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Corrupt, decodeSettings(record, BOUNDS, out));
  TEST_ASSERT_EQUAL(16, out.brightness);
  TEST_ASSERT_EQUAL(PatternId::Flow, out.pattern);
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

static void test_unknown_pattern_reads_as_invalid() {
  SettingsRecord record = encodeSettings(sampleSettings());
  record.pattern = 99;
  reseal(record);
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(record, BOUNDS, out));
}

static void test_off_is_not_a_valid_pattern_to_return_to() {
  SettingsRecord record = encodeSettings(sampleSettings());
  record.lastLitPattern = (uint8_t)PatternId::Off;
  reseal(record);
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(record, BOUNDS, out));
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
  tooFar.calibration.neutralDeg = 80.0f;
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(tooFar), BOUNDS, out));

  Settings notANumber = sampleSettings();
  notANumber.calibration.neutralDeg = NAN;
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(notANumber), BOUNDS, out));
}

static void test_unusable_heel_or_toe_pose_reads_as_invalid() {
  Settings out = defaultSettings(16, DEFAULT_STRIP);

  Settings notANumber = sampleSettings();
  notANumber.calibration.toeDeg = NAN;
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(notANumber), BOUNDS, out));

  Settings pastHalfATurn = sampleSettings();
  pastHalfATurn.calibration.heelDeg = -200.0f;
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(pastHalfATurn), BOUNDS, out));

  Settings sameSide = sampleSettings();
  sameSide.calibration.heelDeg = 20.0f;
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(sameSide), BOUNDS, out));
}

static void test_heel_and_toe_may_be_steeper_than_the_neutral_limit() {
  Settings steep = sampleSettings();
  steep.calibration.toeDeg = 70.0f;
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(steep), BOUNDS, out));
  TEST_ASSERT_EQUAL_FLOAT(70.0f, out.calibration.toeDeg);
}

static void test_a_backward_mounts_poses_round_trip() {
  Settings backward = sampleSettings();
  backward.calibration.neutralDeg = 0.0f;
  backward.calibration.heelDeg = 20.0f;
  backward.calibration.toeDeg = -20.0f;
  Settings out = defaultSettings(16, DEFAULT_STRIP);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(backward), BOUNDS, out));
  TEST_ASSERT_EQUAL_FLOAT(-20.0f, out.calibration.toeDeg);
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

// ── Records saved before the strip layout was a setting ─────────────────

static SettingsRecordV2 sampleV2Record() {
  SettingsRecordV2 record;
  memset(&record, 0, sizeof(record));
  record.magic = SETTINGS_MAGIC;
  record.version = 2;
  record.pattern = (uint8_t)PatternId::FireTrail;
  record.lastLitPattern = (uint8_t)PatternId::FireTrail;
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
  TEST_ASSERT_EQUAL(PatternId::FireTrail, out.pattern);
  TEST_ASSERT_EQUAL(40, out.brightness);
  TEST_ASSERT_TRUE(out.calibration.neutralSet);
  TEST_ASSERT_EQUAL_FLOAT(1.5f, out.calibration.neutralDeg);
  TEST_ASSERT_EQUAL_FLOAT(-18.0f, out.calibration.heelDeg);
  TEST_ASSERT_EQUAL_FLOAT(34.0f, out.calibration.toeDeg);
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

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_defaults_are_flow_and_uncalibrated);
  RUN_TEST(test_round_trip_keeps_every_field);
  RUN_TEST(test_off_round_trips_and_remembers_what_to_return_to);
  RUN_TEST(test_flipped_bit_reads_as_corrupt_and_leaves_output_alone);
  RUN_TEST(test_wrong_magic_reads_as_corrupt);
  RUN_TEST(test_other_version_reads_as_unsupported);
  RUN_TEST(test_unknown_pattern_reads_as_invalid);
  RUN_TEST(test_off_is_not_a_valid_pattern_to_return_to);
  RUN_TEST(test_brightness_outside_the_build_limits_reads_as_invalid);
  RUN_TEST(test_unusable_neutral_offset_reads_as_invalid);
  RUN_TEST(test_unusable_heel_or_toe_pose_reads_as_invalid);
  RUN_TEST(test_heel_and_toe_may_be_steeper_than_the_neutral_limit);
  RUN_TEST(test_a_backward_mounts_poses_round_trip);
  RUN_TEST(test_a_mirrored_strip_layout_round_trips);
  RUN_TEST(test_unusable_strip_layout_reads_as_invalid);
  RUN_TEST(test_v2_record_keeps_its_settings_and_takes_the_default_strip);
  RUN_TEST(test_damaged_v2_record_is_corrupt_and_leaves_output_alone);
  RUN_TEST(test_v2_record_with_bad_values_is_invalid);
  RUN_TEST(test_a_record_of_another_version_is_not_read_as_v2);
  RUN_TEST(test_scheduler_stays_quiet_with_nothing_to_save);
  RUN_TEST(test_scheduler_saves_once_changes_pause);
  RUN_TEST(test_scheduler_is_not_due_when_now_predates_the_change);
  RUN_TEST(test_slider_burst_becomes_one_save);
  RUN_TEST(test_endless_changes_still_save_by_the_longest_delay);
  return UNITY_END();
}
