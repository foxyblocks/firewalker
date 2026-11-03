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

static void test_status_and_calibrate_take_no_arguments() {
  TEST_ASSERT_EQUAL(CommandType::Status, parseCommand("status").type);
  TEST_ASSERT_EQUAL(CommandType::Calibrate, parseCommand("calibrate").type);
  TEST_ASSERT_EQUAL(CommandType::Invalid, parseCommand("status now").type);
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
  formatCalibration(line, sizeof(line), NeutralState::Capturing, 0.0f, 0.0f);
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"calibrate\",\"state\":\"capturing\"}", line);
  formatCalibration(line, sizeof(line), NeutralState::Succeeded, 4.25f, 0.01f);
  TEST_ASSERT_EQUAL_STRING(
      "{\"t\":\"calibrate\",\"state\":\"ok\",\"neutralDeg\":4.25,\"tilt\":0.01}", line);
  formatCalibration(line, sizeof(line), NeutralState::FailedMotion, 0.0f, 0.0f);
  TEST_ASSERT_EQUAL_STRING("{\"t\":\"calibrate\",\"state\":\"failed\",\"reason\":\"motion\"}", line);
  formatCalibration(line, sizeof(line), NeutralState::FailedUnavailable, 0.0f, 0.0f);
  TEST_ASSERT_EQUAL_STRING(
      "{\"t\":\"calibrate\",\"state\":\"failed\",\"reason\":\"sensor-unavailable\"}", line);
}

static StatusReport sampleStatus() {
  StatusReport report{};
  report.id = "A1B2";
  report.pattern = PatternId::FireTrail;
  report.brightness = 32;
  report.maxBrightness = 64;
  report.sensorReady = true;
  report.tilt = -0.25f;
  report.neutralCalibrated = true;
  report.neutralOffsetDeg = 4.5f;
  report.calibration = "ok";
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
      "{\"t\":\"status\",\"id\":\"A1B2\",\"pattern\":\"fire-trail\",\"brightness\":32,"
      "\"maxBrightness\":64,\"sensor\":\"ok\",\"tilt\":-0.25,\"calibrated\":true,"
      "\"neutralDeg\":4.50,\"calibration\":\"ok\",\"saved\":true,\"saveFailed\":false,"
      "\"saves\":3,\"debug\":false,\"ble\":true}",
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
  report.neutralOffsetDeg = -180.0f;
  report.calibration = "sensor-unavailable";
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
  formatMotion(line, sizeof(line), 0.5f, 15.0f, 9.81f, 0.25f, true, 0.75f);
  TEST_ASSERT_EQUAL_STRING(
      "{\"t\":\"motion\",\"tilt\":0.50,\"angleDeg\":15.00,\"accel\":9.81,\"gyro\":0.25,"
      "\"stomp\":true,\"strength\":0.75}",
      line);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_status_and_calibrate_take_no_arguments);
  RUN_TEST(test_pattern_accepts_each_stable_name);
  RUN_TEST(test_power_and_debug_take_on_or_off);
  RUN_TEST(test_brightness_parses_a_whole_byte_value);
  RUN_TEST(test_line_endings_and_extra_spaces_are_ignored);
  RUN_TEST(test_bad_lines_are_rejected_with_a_reason);
  RUN_TEST(test_fixed_point_formatting);
  RUN_TEST(test_acks_report_success_and_failure);
  RUN_TEST(test_calibration_lines_cover_every_outcome);
  RUN_TEST(test_status_reports_the_actual_state);
  RUN_TEST(test_largest_status_fits_the_line_buffer);
  RUN_TEST(test_formatters_truncate_instead_of_overflowing);
  RUN_TEST(test_motion_line);
  return UNITY_END();
}
