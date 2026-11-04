// Native (off-hardware) tests for saved settings: include/firewalker_settings.h.
// Covers the promise that anything missing or damaged in flash falls back to the
// defaults, and that a slider burst doesn't turn into a burst of flash writes. Run
// with `pio test -e native`.
#include <math.h>
#include <unity.h>

#include "firewalker_settings.h"

using namespace Firewalker;

static const SettingsBounds BOUNDS = {1, 64, 45.0f};

void setUp() {}
void tearDown() {}

static Settings sampleSettings() {
  Settings settings = defaultSettings(32);
  settings.pattern = PatternId::FireTrail;
  settings.lastLitPattern = PatternId::FireTrail;
  settings.calibration.neutralSet = true;
  settings.calibration.neutralDeg = -3.5f;
  settings.calibration.heelSet = true;
  settings.calibration.heelDeg = -25.0f;
  settings.calibration.toeSet = true;
  settings.calibration.toeDeg = 60.0f;
  return settings;
}

// Re-signs a record edited by a test, so only the field under test looks wrong.
static void reseal(SettingsRecord& record) {
  record.crc = settingsCrc(&record, offsetof(SettingsRecord, crc));
}

static void test_defaults_are_flow_and_uncalibrated() {
  const Settings settings = defaultSettings(16);
  TEST_ASSERT_EQUAL(PatternId::Flow, settings.pattern);
  TEST_ASSERT_EQUAL(16, settings.brightness);
  TEST_ASSERT_FALSE(settings.calibration.neutralSet);
  TEST_ASSERT_FALSE(settings.calibration.heelSet);
  TEST_ASSERT_FALSE(settings.calibration.toeSet);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, settings.calibration.neutralDeg);
}

static void test_round_trip_keeps_every_field() {
  const SettingsRecord record = encodeSettings(sampleSettings());
  Settings out = defaultSettings(16);
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
}

static void test_off_round_trips_and_remembers_what_to_return_to() {
  Settings settings = sampleSettings();
  settings.pattern = PatternId::Off;
  Settings out = defaultSettings(16);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(settings), BOUNDS, out));
  TEST_ASSERT_EQUAL(PatternId::Off, out.pattern);
  TEST_ASSERT_EQUAL(PatternId::FireTrail, out.lastLitPattern);
}

static void test_flipped_bit_reads_as_corrupt_and_leaves_output_alone() {
  SettingsRecord record = encodeSettings(sampleSettings());
  record.brightness ^= 0x01;
  Settings out = defaultSettings(16);
  TEST_ASSERT_EQUAL(SettingsDecode::Corrupt, decodeSettings(record, BOUNDS, out));
  TEST_ASSERT_EQUAL(16, out.brightness);
  TEST_ASSERT_EQUAL(PatternId::Flow, out.pattern);
}

static void test_wrong_magic_reads_as_corrupt() {
  SettingsRecord record = encodeSettings(sampleSettings());
  record.magic = 0x12345678;
  reseal(record);
  Settings out = defaultSettings(16);
  TEST_ASSERT_EQUAL(SettingsDecode::Corrupt, decodeSettings(record, BOUNDS, out));
}

static void test_other_version_reads_as_unsupported() {
  SettingsRecord record = encodeSettings(sampleSettings());
  record.version = SETTINGS_VERSION + 1;
  reseal(record);
  Settings out = defaultSettings(16);
  TEST_ASSERT_EQUAL(SettingsDecode::Unsupported, decodeSettings(record, BOUNDS, out));
}

static void test_unknown_pattern_reads_as_invalid() {
  SettingsRecord record = encodeSettings(sampleSettings());
  record.pattern = 99;
  reseal(record);
  Settings out = defaultSettings(16);
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(record, BOUNDS, out));
}

static void test_off_is_not_a_valid_pattern_to_return_to() {
  SettingsRecord record = encodeSettings(sampleSettings());
  record.lastLitPattern = (uint8_t)PatternId::Off;
  reseal(record);
  Settings out = defaultSettings(16);
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(record, BOUNDS, out));
}

static void test_brightness_outside_the_build_limits_reads_as_invalid() {
  Settings tooBright = sampleSettings();
  tooBright.brightness = 200;
  Settings out = defaultSettings(16);
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(tooBright), BOUNDS, out));

  Settings tooDim = sampleSettings();
  tooDim.brightness = 0;
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(tooDim), BOUNDS, out));
}

static void test_unusable_neutral_offset_reads_as_invalid() {
  Settings out = defaultSettings(16);

  Settings tooFar = sampleSettings();
  tooFar.calibration.neutralDeg = 80.0f;
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(tooFar), BOUNDS, out));

  Settings notANumber = sampleSettings();
  notANumber.calibration.neutralDeg = NAN;
  TEST_ASSERT_EQUAL(SettingsDecode::Invalid, decodeSettings(encodeSettings(notANumber), BOUNDS, out));
}

static void test_unusable_heel_or_toe_pose_reads_as_invalid() {
  Settings out = defaultSettings(16);

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
  Settings out = defaultSettings(16);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(steep), BOUNDS, out));
  TEST_ASSERT_EQUAL_FLOAT(70.0f, out.calibration.toeDeg);
}

static void test_a_backward_mounts_poses_round_trip() {
  Settings backward = sampleSettings();
  backward.calibration.neutralDeg = 0.0f;
  backward.calibration.heelDeg = 20.0f;
  backward.calibration.toeDeg = -20.0f;
  Settings out = defaultSettings(16);
  TEST_ASSERT_EQUAL(SettingsDecode::Ok, decodeSettings(encodeSettings(backward), BOUNDS, out));
  TEST_ASSERT_EQUAL_FLOAT(-20.0f, out.calibration.toeDeg);
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
  RUN_TEST(test_scheduler_stays_quiet_with_nothing_to_save);
  RUN_TEST(test_scheduler_saves_once_changes_pause);
  RUN_TEST(test_scheduler_is_not_due_when_now_predates_the_change);
  RUN_TEST(test_slider_burst_becomes_one_save);
  RUN_TEST(test_endless_changes_still_save_by_the_longest_delay);
  return UNITY_END();
}
