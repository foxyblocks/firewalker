// Native (off-hardware) tests for the remote protocol:
// include/firewalker_remote_protocol.h. The BLE service and the USB console both
// rely on it, so bad input has to be rejected cleanly and every reply has to fit its
// buffer. Run with `pio test -e native`.
#include <string.h>
#include <unity.h>

#include "firewalker_remote_protocol.h"

using namespace Firewalker;

void setUp() {}
void tearDown() {}

static void test_commands_with_no_arguments() {
  TEST_ASSERT_EQUAL(CommandType::Status, parseCommand("status").type);
  TEST_ASSERT_EQUAL(CommandType::Patterns, parseCommand("patterns").type);
  TEST_ASSERT_EQUAL(CommandType::Identify, parseCommand("identify").type);
  TEST_ASSERT_EQUAL_STRING("too-many-arguments", parseCommand("status now").error);
  TEST_ASSERT_EQUAL_STRING("too-many-arguments", parseCommand("identify now").error);
}

static void test_calibrate_takes_an_optional_pose() {
  const Command bare = parseCommand("calibrate");
  TEST_ASSERT_EQUAL(CommandType::Calibrate, bare.type);
  TEST_ASSERT_EQUAL(CalibrationPose::Neutral, bare.pose);
  TEST_ASSERT_EQUAL(CalibrationPose::Neutral, parseCommand("calibrate neutral").pose);
  TEST_ASSERT_EQUAL(CalibrationPose::Heel, parseCommand("calibrate heel").pose);
  TEST_ASSERT_EQUAL(CalibrationPose::Toe, parseCommand("calibrate toe").pose);
  TEST_ASSERT_EQUAL_STRING("unknown-pose", parseCommand("calibrate knee").error);
  TEST_ASSERT_EQUAL_STRING("too-many-arguments", parseCommand("calibrate heel now").error);
}

static void test_strip_commands_name_a_setting_and_a_value() {
  const Command leds = parseCommand("strip leds 110");
  TEST_ASSERT_EQUAL(CommandType::StripSet, leds.type);
  TEST_ASSERT_EQUAL(StripField::Count, leds.stripField);
  TEST_ASSERT_EQUAL(110, leds.value);

  const Command toe = parseCommand("strip toe 0");
  TEST_ASSERT_EQUAL(CommandType::StripSet, toe.type);
  TEST_ASSERT_EQUAL(StripField::Toe, toe.stripField);
  TEST_ASSERT_EQUAL(0, toe.value);

  const Command heel = parseCommand("strip heel 90");
  TEST_ASSERT_EQUAL(StripField::Heel, heel.stripField);
  TEST_ASSERT_EQUAL(90, heel.value);
}

static void test_strip_commands_reject_bad_input() {
  TEST_ASSERT_EQUAL_STRING("expected-setting-and-value", parseCommand("strip").error);
  TEST_ASSERT_EQUAL_STRING("expected-setting-and-value", parseCommand("strip leds").error);
  TEST_ASSERT_EQUAL_STRING("too-many-arguments", parseCommand("strip leds 110 now").error);
  TEST_ASSERT_EQUAL_STRING("unknown-strip-setting", parseCommand("strip arch 40").error);
  TEST_ASSERT_EQUAL_STRING("expected-number", parseCommand("strip leds lots").error);
  TEST_ASSERT_EQUAL_STRING("expected-number", parseCommand("strip toe -1").error);
  TEST_ASSERT_EQUAL_STRING("expected-number", parseCommand("strip toe 12x").error);
  TEST_ASSERT_EQUAL_STRING("expected-number", parseCommand("strip toe 99999").error);
}

static void test_strip_preview_turns_on_or_off() {
  const Command on = parseCommand("strip preview on");
  TEST_ASSERT_EQUAL(CommandType::StripPreview, on.type);
  TEST_ASSERT_TRUE(on.on);

  const Command off = parseCommand("strip preview off");
  TEST_ASSERT_EQUAL(CommandType::StripPreview, off.type);
  TEST_ASSERT_FALSE(off.on);

  TEST_ASSERT_EQUAL_STRING("expected-on-or-off", parseCommand("strip preview toe").error);
}

static void test_strip_commands_ack_as_strip() {
  char line[REMOTE_LINE_MAX];
  formatAck(line, sizeof(line), CommandType::StripSet, false, "same-pixel");
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"ack\",\"cmd\":\"strip\",\"ok\":false,\"error\":\"same-pixel\"}", line);
  formatAck(line, sizeof(line), CommandType::StripPreview, true);
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"ack\",\"cmd\":\"strip\",\"ok\":true}", line);
}

static void test_every_command_fits_a_default_ble_write() {
  const char* longest[] = {"calibrate neutral", "pattern fire-trail", "brightness 255",
                           "strip preview off", "strip leds 160", "cap off"};
  for (const char* command : longest) {
    TEST_ASSERT_TRUE(strlen(command) <= 20);
  }
  // `pattern <name>` with the longest legal name fits too.
  TEST_ASSERT_TRUE(strlen("pattern ") + PATTERN_NAME_MAX_LENGTH <= 20);
}

static void test_patterns_line_lists_what_can_be_selected() {
  char line[REMOTE_LINE_MAX];
  const char* names[] = {"flow", "fire-trail", "comet"};
  formatPatterns(line, sizeof(line), names, 3);
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"patterns\",\"list\":[\"flow\",\"fire-trail\",\"comet\"]}", line);
}

static void test_the_longest_patterns_line_fits_the_line_buffer() {
  const char* names[32];
  for (const char*& name : names) name = "abcdefghijkl";
  char line[REMOTE_LINE_MAX];
  formatPatterns(line, sizeof(line), names, 32);
  TEST_ASSERT_TRUE(strlen(line) < sizeof(line) - 1);
  TEST_ASSERT_EQUAL_STRING("]}", line + strlen(line) - 2);
}

static void test_pattern_takes_any_legally_spelled_name() {
  const char* const names[] = {"flow", "fire-trail", "off", "sparkle", "abcdefghijkl"};
  for (const char* name : names) {
    char line[REMOTE_COMMAND_MAX];
    snprintf(line, sizeof(line), "pattern %s", name);
    const Command command = parseCommand(line);
    TEST_ASSERT_EQUAL(CommandType::Pattern, command.type);
    TEST_ASSERT_EQUAL_STRING(name, command.pattern);
  }
}

static void test_pattern_refuses_a_name_no_pattern_could_have() {
  const char* const lines[] = {"pattern Flow", "pattern 9lives", "pattern abcdefghijklm", "pattern ../etc"};
  for (const char* line : lines) {
    const Command command = parseCommand(line);
    TEST_ASSERT_EQUAL(CommandType::Invalid, command.type);
    TEST_ASSERT_EQUAL_STRING("unknown-pattern", command.error);
  }
}

static void test_recipes_takes_no_arguments() {
  TEST_ASSERT_EQUAL(CommandType::Recipes, parseCommand("recipes").type);
  TEST_ASSERT_EQUAL_STRING("too-many-arguments", parseCommand("recipes now").error);
}

static void test_recipe_info_and_delete_take_a_name() {
  const Command info = parseCommand("recipe info comet");
  TEST_ASSERT_EQUAL(CommandType::RecipeInfo, info.type);
  TEST_ASSERT_EQUAL_STRING("comet", info.pattern);
  const Command remove = parseCommand("recipe delete comet");
  TEST_ASSERT_EQUAL(CommandType::RecipeDelete, remove.type);
  TEST_ASSERT_EQUAL_STRING("comet", remove.pattern);

  TEST_ASSERT_EQUAL_STRING("expected-one-argument", parseCommand("recipe info").error);
  TEST_ASSERT_EQUAL_STRING("expected-one-argument", parseCommand("recipe delete a b").error);
  TEST_ASSERT_EQUAL_STRING("bad-name", parseCommand("recipe delete Comet").error);
}

static void test_recipe_begin_takes_a_name_and_a_size() {
  const Command begin = parseCommand("recipe begin abcdefghijkl 254");
  TEST_ASSERT_EQUAL(CommandType::RecipeBegin, begin.type);
  TEST_ASSERT_EQUAL_STRING("abcdefghijkl", begin.pattern);
  TEST_ASSERT_EQUAL_INT32(254, begin.value);

  TEST_ASSERT_EQUAL_STRING("expected-name-and-size", parseCommand("recipe begin comet").error);
  TEST_ASSERT_EQUAL_STRING("bad-name", parseCommand("recipe begin Comet 74").error);
  TEST_ASSERT_EQUAL_STRING("expected-number", parseCommand("recipe begin comet many").error);
  TEST_ASSERT_EQUAL_STRING("expected-number", parseCommand("recipe begin comet -4").error);
}

static void test_recipe_data_takes_an_offset_and_hex() {
  const char* longest = "recipe data 240 0123456789abcdef0123456789abcd";
  TEST_ASSERT_TRUE(strlen(longest) < REMOTE_COMMAND_MAX);
  const Command data = parseCommand(longest);
  TEST_ASSERT_EQUAL(CommandType::RecipeData, data.type);
  TEST_ASSERT_EQUAL_INT32(240, data.value);
  TEST_ASSERT_EQUAL_STRING("0123456789abcdef0123456789abcd", data.hex);

  TEST_ASSERT_EQUAL_STRING("expected-offset-and-hex", parseCommand("recipe data 0").error);
  TEST_ASSERT_EQUAL_STRING("expected-number", parseCommand("recipe data x 00").error);
  TEST_ASSERT_EQUAL_STRING("bad-hex", parseCommand("recipe data 0 0123456789abcdef0123456789abcdef").error);
}

static void test_recipe_end_and_cancel_take_nothing() {
  TEST_ASSERT_EQUAL(CommandType::RecipeEnd, parseCommand("recipe end").type);
  TEST_ASSERT_EQUAL(CommandType::RecipeCancel, parseCommand("recipe cancel").type);
  TEST_ASSERT_EQUAL_STRING("too-many-arguments", parseCommand("recipe end now").error);
  TEST_ASSERT_EQUAL_STRING("expected-recipe-command", parseCommand("recipe").error);
  TEST_ASSERT_EQUAL_STRING("unknown-recipe-command", parseCommand("recipe burn").error);
  TEST_ASSERT_EQUAL_STRING("too-many-arguments", parseCommand("recipe data 0 00 extra").error);
}

static void test_recipe_replies_are_well_formed() {
  char line[REMOTE_LINE_MAX];
  formatRecipeAck(line, sizeof(line), true, nullptr, 15);
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"ack\",\"cmd\":\"recipe\",\"ok\":true,\"next\":15}", line);
  formatRecipeAck(line, sizeof(line), false, "wrong-offset", 30);
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"ack\",\"cmd\":\"recipe\",\"ok\":false,\"error\":\"wrong-offset\",\"next\":30}", line);
  formatRecipeAck(line, sizeof(line), true, nullptr, -1);
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"ack\",\"cmd\":\"recipe\",\"ok\":true}", line);

  UploadedRecipe slots[16] = {};
  formatRecipes(line, sizeof(line), 1, slots, 16);
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"recipes\",\"versions\":[1],\"slots\":16,\"free\":16,\"list\":[]}", line);
  slots[3].used = true;
  copyPatternName(slots[3].name, "comet");
  slots[3].size = 74;
  slots[3].crc = 0xCB75D224u;
  formatRecipes(line, sizeof(line), 1, slots, 16);
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"recipes\",\"versions\":[1],\"slots\":16,\"free\":15,\"list\":[\"comet\"]}", line);
  formatRecipeInfo(line, sizeof(line), slots[3]);
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"recipe\",\"name\":\"comet\",\"bytes\":74,\"crc\":\"cb75d224\"}", line);
}

static void test_the_longest_recipes_line_fits() {
  UploadedRecipe slots[16] = {};
  for (UploadedRecipe& slot : slots) {
    slot.used = true;
    copyPatternName(slot.name, "abcdefghijkl");
  }
  char line[REMOTE_LINE_MAX];
  formatRecipes(line, sizeof(line), 1, slots, 16);
  TEST_ASSERT_EQUAL_STRING("]}", line + strlen(line) - 2);
}

static void test_power_and_debug_take_on_or_off() {
  const Command power = parseCommand("power off");
  TEST_ASSERT_EQUAL(CommandType::Power, power.type);
  TEST_ASSERT_FALSE(power.on);

  const Command debug = parseCommand("debug on");
  TEST_ASSERT_EQUAL(CommandType::Debug, debug.type);
  TEST_ASSERT_TRUE(debug.on);

  TEST_ASSERT_EQUAL_STRING("expected-on-or-off", parseCommand("power maybe").error);
}

static void test_cap_turns_the_soft_cap_on_or_off() {
  const Command on = parseCommand("cap on");
  TEST_ASSERT_EQUAL(CommandType::Cap, on.type);
  TEST_ASSERT_TRUE(on.on);
  const Command off = parseCommand("cap off");
  TEST_ASSERT_EQUAL(CommandType::Cap, off.type);
  TEST_ASSERT_FALSE(off.on);

  TEST_ASSERT_EQUAL_STRING("expected-on-or-off", parseCommand("cap 96").error);
  TEST_ASSERT_EQUAL_STRING("expected-one-argument", parseCommand("cap").error);

  char line[REMOTE_LINE_MAX];
  formatAck(line, sizeof(line), CommandType::Cap, true);
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"ack\",\"cmd\":\"cap\",\"ok\":true}", line);
}

static void test_brightness_parses_a_whole_byte_value() {
  const Command command = parseCommand("brightness 32");
  TEST_ASSERT_EQUAL(CommandType::Brightness, command.type);
  TEST_ASSERT_EQUAL(32, command.value);

  TEST_ASSERT_EQUAL(CommandType::Invalid, parseCommand("brightness 256").type);
  TEST_ASSERT_EQUAL(CommandType::Invalid, parseCommand("brightness -1").type);
  TEST_ASSERT_EQUAL(CommandType::Invalid, parseCommand("brightness 12x").type);
  TEST_ASSERT_EQUAL(CommandType::Invalid, parseCommand("brightness").type);
}

static void test_line_endings_and_extra_spaces_are_ignored() {
  TEST_ASSERT_EQUAL(CommandType::Status, parseCommand("status\r\n").type);
  TEST_ASSERT_EQUAL(32, parseCommand("  brightness   32 \n").value);
}

static void test_bad_lines_are_rejected_with_a_reason() {
  TEST_ASSERT_EQUAL_STRING("empty", parseCommand("").error);
  TEST_ASSERT_EQUAL_STRING("empty", parseCommand("   \r\n").error);
  TEST_ASSERT_EQUAL_STRING("empty", parseCommand(nullptr).error);
  TEST_ASSERT_EQUAL_STRING("unknown-command", parseCommand("dance now").error);
  TEST_ASSERT_EQUAL_STRING("unknown-command", parseCommand("nonsense").error);
  TEST_ASSERT_EQUAL_STRING("expected-one-argument", parseCommand("pattern").error);
  TEST_ASSERT_EQUAL_STRING("expected-one-argument", parseCommand("power on now").error);
  TEST_ASSERT_EQUAL_STRING("too-many-arguments", parseCommand("a b c d").error);

  char tooLong[REMOTE_COMMAND_MAX + 8];
  memset(tooLong, 'x', sizeof(tooLong) - 1);
  tooLong[sizeof(tooLong) - 1] = '\0';
  TEST_ASSERT_EQUAL_STRING("too-long", parseCommand(tooLong).error);
}

static void test_fixed_point_formatting() {
  char text[16];
  formatFixed2(text, sizeof(text), 0.0f);
  TEST_ASSERT_EQUAL_STRING("0.00", text);
  formatFixed2(text, sizeof(text), -1.5f);
  TEST_ASSERT_EQUAL_STRING("-1.50", text);
  formatFixed2(text, sizeof(text), 9.816f);
  TEST_ASSERT_EQUAL_STRING("9.82", text);
  // Rounding to zero shouldn't print a negative sign.
  formatFixed2(text, sizeof(text), -0.001f);
  TEST_ASSERT_EQUAL_STRING("0.00", text);
}

static void test_acks_report_success_and_failure() {
  char line[REMOTE_LINE_MAX];
  formatAck(line, sizeof(line), CommandType::Brightness, true);
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"ack\",\"cmd\":\"brightness\",\"ok\":true}", line);
  formatAck(line, sizeof(line), CommandType::Invalid, false, "unknown-command");
  TEST_ASSERT_EQUAL_STRING(
      "{\"t\":\"ack\",\"cmd\":\"unknown\",\"ok\":false,\"error\":\"unknown-command\"}", line);
}

static void test_calibration_lines_cover_every_outcome() {
  char line[REMOTE_LINE_MAX];
  formatCalibrationCapturing(line, sizeof(line), CalibrationPose::Neutral);
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"calibrate\",\"pose\":\"neutral\",\"state\":\"capturing\"}", line);
  formatCalibrationOk(line, sizeof(line), CalibrationPose::Heel, -18.4f, -1.0f);
  TEST_ASSERT_EQUAL_STRING(
      "{\"t\":\"calibrate\",\"pose\":\"heel\",\"state\":\"ok\",\"angleDeg\":-18.40,\"tilt\":-1.00}", line);
  formatCalibrationFailed(line, sizeof(line), CalibrationPose::Toe, "wrong-side");
  TEST_ASSERT_EQUAL_STRING(
      "{\"t\":\"calibrate\",\"pose\":\"toe\",\"state\":\"failed\",\"reason\":\"wrong-side\"}", line);
}

static void test_capture_failures_have_reasons() {
  TEST_ASSERT_EQUAL_STRING("motion", captureFailureReason(CaptureState::FailedMotion));
  TEST_ASSERT_EQUAL_STRING("no-samples", captureFailureReason(CaptureState::FailedNoSamples));
  TEST_ASSERT_EQUAL_STRING("sensor-unavailable", captureFailureReason(CaptureState::FailedUnavailable));
}

static StatusReport sampleStatus() {
  StatusReport report{};
  report.id = "A1B2";
  report.pattern = "off";
  report.lit = "fire-trail";
  report.brightness = 32;
  report.maxBrightness = 48;
  report.capped = true;
  report.capBrightness = 48;
  report.sensorReady = true;
  report.tilt = -0.25f;
  report.calibration.neutralSet = true;
  report.calibration.neutralDeg = 4.5f;
  report.calibration.toeSet = true;
  report.calibration.toeDeg = 34.0f;
  report.calibrationState = "ok";
  report.saved = true;
  report.saveFailed = false;
  report.saves = 3;
  report.debug = false;
  report.bleConnected = true;
  report.strip = {110, 40, 90};
  report.maxLeds = 160;
  report.preview = true;
  return report;
}

static void test_status_reports_the_actual_state() {
  char line[REMOTE_LINE_MAX];
  formatStatus(line, sizeof(line), sampleStatus());
  TEST_ASSERT_EQUAL_STRING(
      "{\"t\":\"status\",\"proto\":3,\"id\":\"A1B2\",\"pattern\":\"off\",\"lit\":\"fire-trail\","
      "\"brightness\":32,\"maxBrightness\":48,\"capped\":true,\"capBrightness\":48,\"sensor\":\"ok\","
      "\"tilt\":-0.25,\"calibrated\":true,"
      "\"neutralDeg\":4.50,\"heelDeg\":null,\"toeDeg\":34.00,\"calibration\":\"ok\",\"saved\":true,"
      "\"saveFailed\":false,\"saves\":3,\"debug\":false,\"ble\":true,\"leds\":110,\"maxLeds\":160,"
      "\"toe\":40,\"heel\":90,\"preview\":true}",
      line);
}

static void test_largest_status_fits_the_line_buffer() {
  StatusReport report = sampleStatus();
  report.id = "FFFFFFFF";
  report.pattern = "abcdefghijkl";
  report.lit = "abcdefghijkl";
  report.brightness = 255;
  report.maxBrightness = 255;
  report.capped = false;
  report.capBrightness = 255;
  report.sensorReady = false;
  report.tilt = -1.0f;
  report.calibration.neutralDeg = -180.0f;
  report.calibration.heelSet = true;
  report.calibration.heelDeg = -179.99f;
  report.calibration.toeSet = true;
  report.calibration.toeDeg = -179.99f;
  report.calibrationState = "sensor-unavailable";
  report.saveFailed = true;
  report.saved = false;
  report.saves = 4294967295u;
  report.debug = true;
  report.strip = {4096, 4095, 4094};
  report.maxLeds = 4096;
  report.preview = false;
  char line[REMOTE_LINE_MAX];
  formatStatus(line, sizeof(line), report);
  // A truncated line would be missing its closing brace.
  TEST_ASSERT_EQUAL_CHAR('}', line[strlen(line) - 1]);
  TEST_ASSERT_LESS_THAN(REMOTE_LINE_MAX - 1, strlen(line));
}

static void test_formatters_truncate_instead_of_overflowing() {
  char line[16];
  memset(line, 'x', sizeof(line));
  formatStatus(line, sizeof(line), sampleStatus());
  TEST_ASSERT_EQUAL(15, strlen(line));
}

static void test_motion_line() {
  char line[REMOTE_LINE_MAX];
  formatMotion(line, sizeof(line), 0.5f, 15.0f, 9.81f, 25.5f, 0.25f, true, 0.75f, 7321);
  TEST_ASSERT_EQUAL_STRING(
      "{\"t\":\"motion\",\"tilt\":0.50,\"angleDeg\":15.00,\"accel\":9.81,\"accelPeak\":25.50,"
      "\"gyro\":0.25,\"stomp\":true,\"strength\":0.75,\"frameUs\":7321}",
      line);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_commands_with_no_arguments);
  RUN_TEST(test_calibrate_takes_an_optional_pose);
  RUN_TEST(test_strip_commands_name_a_setting_and_a_value);
  RUN_TEST(test_strip_commands_reject_bad_input);
  RUN_TEST(test_strip_preview_turns_on_or_off);
  RUN_TEST(test_strip_commands_ack_as_strip);
  RUN_TEST(test_every_command_fits_a_default_ble_write);
  RUN_TEST(test_patterns_line_lists_what_can_be_selected);
  RUN_TEST(test_the_longest_patterns_line_fits_the_line_buffer);
  RUN_TEST(test_pattern_takes_any_legally_spelled_name);
  RUN_TEST(test_pattern_refuses_a_name_no_pattern_could_have);
  RUN_TEST(test_recipes_takes_no_arguments);
  RUN_TEST(test_recipe_info_and_delete_take_a_name);
  RUN_TEST(test_recipe_begin_takes_a_name_and_a_size);
  RUN_TEST(test_recipe_data_takes_an_offset_and_hex);
  RUN_TEST(test_recipe_end_and_cancel_take_nothing);
  RUN_TEST(test_recipe_replies_are_well_formed);
  RUN_TEST(test_the_longest_recipes_line_fits);
  RUN_TEST(test_power_and_debug_take_on_or_off);
  RUN_TEST(test_brightness_parses_a_whole_byte_value);
  RUN_TEST(test_line_endings_and_extra_spaces_are_ignored);
  RUN_TEST(test_bad_lines_are_rejected_with_a_reason);
  RUN_TEST(test_fixed_point_formatting);
  RUN_TEST(test_acks_report_success_and_failure);
  RUN_TEST(test_calibration_lines_cover_every_outcome);
  RUN_TEST(test_capture_failures_have_reasons);
  RUN_TEST(test_cap_turns_the_soft_cap_on_or_off);
  RUN_TEST(test_status_reports_the_actual_state);
  RUN_TEST(test_largest_status_fits_the_line_buffer);
  RUN_TEST(test_formatters_truncate_instead_of_overflowing);
  RUN_TEST(test_motion_line);
  return UNITY_END();
}
