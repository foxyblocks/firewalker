// Native (off-hardware) tests for the neutral capture: include/firewalker_neutral.h.
// A capture has to average a still boot and refuse everything else, so a bad capture
// can never replace a good calibration. Run with `pio test -e native`.
#include <unity.h>

#include "firewalker_neutral.h"

using namespace Firewalker;

static const NeutralLimits LIMITS = {
    1000,     // windowMs
    500,      // noSampleMs
    25,       // minSamples
    3.0f,     // maxRangeDeg
    0.25f,    // maxGyroRadS
    9.81f,    // gravity
    1.5f,     // maxAccelDev
    45.0f,    // maxOffsetDeg
};

void setUp() {}
void tearDown() {}

// Feeds a whole window of identical still samples at 50 Hz, the sensor's rate.
static void feedStillWindow(NeutralCapture& capture, uint32_t startMs, float angleDeg) {
  for (uint32_t t = 20; t <= LIMITS.windowMs; t += 20) {
    capture.addSample(startMs + t, angleDeg, 0.01f, 9.81f);
  }
}

static void test_still_boot_captures_its_average_angle() {
  NeutralCapture capture(LIMITS);
  capture.start(1000, true);
  TEST_ASSERT_TRUE(capture.capturing());
  feedStillWindow(capture, 1000, 4.0f);
  TEST_ASSERT_EQUAL(NeutralState::Succeeded, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 4.0f, capture.offsetDeg());
}

static void test_small_wobble_is_averaged_not_rejected() {
  NeutralCapture capture(LIMITS);
  capture.start(0, true);
  for (uint32_t t = 20; t <= LIMITS.windowMs; t += 20) {
    capture.addSample(t, (t % 40 == 0) ? 3.0f : 5.0f, 0.02f, 9.8f);
  }
  TEST_ASSERT_EQUAL(NeutralState::Succeeded, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.05f, 4.0f, capture.offsetDeg());
}

static void test_capture_does_not_finish_before_the_window_ends() {
  NeutralCapture capture(LIMITS);
  capture.start(0, true);
  capture.addSample(20, 1.0f, 0.0f, 9.81f);
  TEST_ASSERT_TRUE(capture.capturing());
}

static void test_rotation_fails_as_motion() {
  NeutralCapture capture(LIMITS);
  capture.start(0, true);
  capture.addSample(20, 1.0f, 2.0f, 9.81f);
  TEST_ASSERT_EQUAL(NeutralState::FailedMotion, capture.state());
}

static void test_acceleration_away_from_gravity_fails_as_motion() {
  NeutralCapture capture(LIMITS);
  capture.start(0, true);
  capture.addSample(20, 1.0f, 0.0f, 14.0f);
  TEST_ASSERT_EQUAL(NeutralState::FailedMotion, capture.state());
}

static void test_slow_drift_past_the_range_fails_as_motion() {
  NeutralCapture capture(LIMITS);
  capture.start(0, true);
  capture.addSample(20, 0.0f, 0.0f, 9.81f);
  capture.addSample(40, 4.0f, 0.0f, 9.81f);
  TEST_ASSERT_EQUAL(NeutralState::FailedMotion, capture.state());
}

static void test_unavailable_sensor_fails_immediately() {
  NeutralCapture capture(LIMITS);
  capture.start(0, false);
  TEST_ASSERT_EQUAL(NeutralState::FailedUnavailable, capture.state());
}

static void test_samples_stopping_fails_as_no_samples() {
  NeutralCapture capture(LIMITS);
  capture.start(0, true);
  capture.addSample(20, 1.0f, 0.0f, 9.81f);
  capture.poll(100);
  TEST_ASSERT_TRUE(capture.capturing());
  capture.poll(520);
  TEST_ASSERT_EQUAL(NeutralState::FailedNoSamples, capture.state());
}

static void test_too_few_samples_in_the_window_fails_as_no_samples() {
  NeutralCapture capture(LIMITS);
  capture.start(0, true);
  capture.addSample(400, 1.0f, 0.0f, 9.81f);
  capture.addSample(800, 1.0f, 0.0f, 9.81f);
  capture.addSample(1000, 1.0f, 0.0f, 9.81f);
  TEST_ASSERT_EQUAL(NeutralState::FailedNoSamples, capture.state());
}

static void test_angle_far_from_level_fails_as_out_of_range() {
  NeutralCapture capture(LIMITS);
  capture.start(0, true);
  feedStillWindow(capture, 0, 60.0f);
  TEST_ASSERT_EQUAL(NeutralState::FailedOutOfRange, capture.state());
}

static void test_failed_capture_keeps_the_previous_offset_readable_state() {
  NeutralCapture capture(LIMITS);
  capture.start(0, true);
  feedStillWindow(capture, 0, 2.0f);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 2.0f, capture.offsetDeg());
  // A later failed capture must not report a new value to apply.
  capture.start(2000, true);
  capture.addSample(2020, 30.0f, 3.0f, 9.81f);
  TEST_ASSERT_EQUAL(NeutralState::FailedMotion, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 2.0f, capture.offsetDeg());
}

static void test_samples_after_finishing_are_ignored() {
  NeutralCapture capture(LIMITS);
  capture.start(0, true);
  feedStillWindow(capture, 0, 2.0f);
  capture.addSample(1100, 40.0f, 5.0f, 20.0f);
  TEST_ASSERT_EQUAL(NeutralState::Succeeded, capture.state());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_still_boot_captures_its_average_angle);
  RUN_TEST(test_small_wobble_is_averaged_not_rejected);
  RUN_TEST(test_capture_does_not_finish_before_the_window_ends);
  RUN_TEST(test_rotation_fails_as_motion);
  RUN_TEST(test_acceleration_away_from_gravity_fails_as_motion);
  RUN_TEST(test_slow_drift_past_the_range_fails_as_motion);
  RUN_TEST(test_unavailable_sensor_fails_immediately);
  RUN_TEST(test_samples_stopping_fails_as_no_samples);
  RUN_TEST(test_too_few_samples_in_the_window_fails_as_no_samples);
  RUN_TEST(test_angle_far_from_level_fails_as_out_of_range);
  RUN_TEST(test_failed_capture_keeps_the_previous_offset_readable_state);
  RUN_TEST(test_samples_after_finishing_are_ignored);
  return UNITY_END();
}
