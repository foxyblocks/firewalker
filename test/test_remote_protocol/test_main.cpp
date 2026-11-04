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

static void test_every_command_fits_a_default_ble_write() {
  const char* longest[] = {"calibrate neutral", "pattern fire-trail", "brightness 255"};
  for (const char* command : longest) {
    TEST_ASSERT_TRUE(strlen(command) <= 20);
  }
  for (PatternId pattern : SELECTABLE_PATTERNS) {
    TEST_ASSERT_TRUE(strlen(patternName(pattern)) <= 12);
  }
}

static void test_patterns_line_lists_what_can_be_selected() {
  char line[REMOTE_LINE_MAX];
  formatPatterns(line, sizeof(line));
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"patterns\",\"list\":[\"flow\",\"fire-trail\"]}", line);
}

static void test_pattern_accepts_each_stable_name() {
  TEST_ASSERT_EQUAL(PatternId::Flow, parseCommand("pattern flow").pattern);
  TEST_ASSERT_EQUAL(PatternId::FireTrail, parseCommand("pattern fire-trail").pattern);
  TEST_ASSERT_EQUAL(PatternId::Off, parseCommand("pattern off").pattern);

  const Command unknown = parseCommand("pattern sparkle");
  TEST_ASSERT_EQUAL(CommandType::Invalid, unknown.type);
  TEST_ASSERT_EQUAL_STRING("unknown-pattern", unknown.error);
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
  report.pattern = PatternId::Off;
  report.lit = PatternId::FireTrail;
  report.brightness = 32;
  report.maxBrightness = 64;
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
  return report;
}

static void test_status_reports_the_actual_state() {
  char line[REMOTE_LINE_MAX];
  formatStatus(line, sizeof(line), sampleStatus());
  TEST_ASSERT_EQUAL_STRING(
      "{\"t\":\"status\",\"proto\":1,\"id\":\"A1B2\",\"pattern\":\"off\",\"lit\":\"fire-trail\","
      "\"brightness\":32,\"maxBrightness\":64,\"sensor\":\"ok\",\"tilt\":-0.25,\"calibrated\":true,"
      "\"neutralDeg\":4.50,\"heelDeg\":null,\"toeDeg\":34.00,\"calibration\":\"ok\",\"saved\":true,"
      "\"saveFailed\":false,\"saves\":3,\"debug\":false,\"ble\":true}",
      line);
}

static void test_largest_status_fits_the_line_buffer() {
  StatusReport report = sampleStatus();
  report.id = "FFFFFFFF";
  report.pattern = PatternId::FireTrail;
  report.brightness = 255;
  report.maxBrightness = 255;
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
  formatMotion(line, sizeof(line), 0.5f, 15.0f, 9.81f, 25.5f, 0.25f, true, 0.75f);
  TEST_ASSERT_EQUAL_STRING(
      "{\"t\":\"motion\",\"tilt\":0.50,\"angleDeg\":15.00,\"accel\":9.81,\"accelPeak\":25.50,"
      "\"gyro\":0.25,\"stomp\":true,\"strength\":0.75}",
      line);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_commands_with_no_arguments);
  RUN_TEST(test_calibrate_takes_an_optional_pose);
  RUN_TEST(test_every_command_fits_a_default_ble_write);
  RUN_TEST(test_patterns_line_lists_what_can_be_selected);
  RUN_TEST(test_pattern_accepts_each_stable_name);
  RUN_TEST(test_power_and_debug_take_on_or_off);
  RUN_TEST(test_brightness_parses_a_whole_byte_value);
  RUN_TEST(test_line_endings_and_extra_spaces_are_ignored);
  RUN_TEST(test_bad_lines_are_rejected_with_a_reason);
  RUN_TEST(test_fixed_point_formatting);
  RUN_TEST(test_acks_report_success_and_failure);
  RUN_TEST(test_calibration_lines_cover_every_outcome);
  RUN_TEST(test_capture_failures_have_reasons);
  RUN_TEST(test_status_reports_the_actual_state);
  RUN_TEST(test_largest_status_fits_the_line_buffer);
  RUN_TEST(test_formatters_truncate_instead_of_overflowing);
  RUN_TEST(test_motion_line);
  return UNITY_END();
}
