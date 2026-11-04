// Native (off-hardware) tests for tilt calibration: include/firewalker_calibration.h. A
// capture has to average a still boot and refuse everything else, the three poses have to
// map onto -1, 0, and +1, and a rejected pose can never disturb a good calibration. Run
// with `pio test -e native`.
#include <unity.h>

#include "firewalker_calibration.h"

using namespace Firewalker;

static const PoseCaptureLimits CAPTURE = {
    1000,   // windowMs
    500,    // noSampleMs
    25,     // minSamples
    3.0f,   // maxRangeDeg
    0.25f,  // maxGyroRadS
    9.81f,  // gravity
    1.5f,   // maxAccelDev
};

static const TiltLimits LIMITS = {
    30.0f,  // defaultRangeDeg
    3.0f,   // deadzoneDeg
    10.0f,  // minSideDeg
    45.0f,  // maxNeutralDeg
};

void setUp() {}
void tearDown() {}

// Feeds a whole window of identical still samples at 50 Hz, the sensor's rate.
static void feedStillWindow(PoseCapture& capture, uint32_t startMs, float angleDeg) {
  for (uint32_t t = 20; t <= CAPTURE.windowMs; t += 20) {
    capture.addSample(startMs + t, angleDeg, 0.01f, 9.81f);
  }
}

// ── PoseCapture ───────────────────────────────────────────────────────────

static void test_still_boot_captures_its_average_angle() {
  PoseCapture capture(CAPTURE);
  capture.start(1000, true);
  TEST_ASSERT_TRUE(capture.capturing());
  feedStillWindow(capture, 1000, 4.0f);
  TEST_ASSERT_EQUAL(CaptureState::Succeeded, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 4.0f, capture.meanDeg());
}

static void test_small_wobble_is_averaged_not_rejected() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  for (uint32_t t = 20; t <= CAPTURE.windowMs; t += 20) {
    capture.addSample(t, (t % 40 == 0) ? 3.0f : 5.0f, 0.02f, 9.8f);
  }
  TEST_ASSERT_EQUAL(CaptureState::Succeeded, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.05f, 4.0f, capture.meanDeg());
}

static void test_a_steep_pose_can_be_captured() {
  // The neutral limit belongs to applyPose, so a capture itself takes any angle.
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  feedStillWindow(capture, 0, 70.0f);
  TEST_ASSERT_EQUAL(CaptureState::Succeeded, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 70.0f, capture.meanDeg());
}

static void test_capture_does_not_finish_before_the_window_ends() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  capture.addSample(20, 1.0f, 0.0f, 9.81f);
  TEST_ASSERT_TRUE(capture.capturing());
}

static void test_rotation_fails_as_motion() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  capture.addSample(20, 1.0f, 2.0f, 9.81f);
  TEST_ASSERT_EQUAL(CaptureState::FailedMotion, capture.state());
}

static void test_acceleration_away_from_gravity_fails_as_motion() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  capture.addSample(20, 1.0f, 0.0f, 14.0f);
  TEST_ASSERT_EQUAL(CaptureState::FailedMotion, capture.state());
}

static void test_slow_drift_past_the_range_fails_as_motion() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  capture.addSample(20, 0.0f, 0.0f, 9.81f);
  capture.addSample(40, 4.0f, 0.0f, 9.81f);
  TEST_ASSERT_EQUAL(CaptureState::FailedMotion, capture.state());
}

static void test_unavailable_sensor_fails_immediately() {
  PoseCapture capture(CAPTURE);
  capture.start(0, false);
  TEST_ASSERT_EQUAL(CaptureState::FailedUnavailable, capture.state());
}

static void test_samples_stopping_fails_as_no_samples() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  capture.addSample(20, 1.0f, 0.0f, 9.81f);
  capture.poll(100);
  TEST_ASSERT_TRUE(capture.capturing());
  capture.poll(520);
  TEST_ASSERT_EQUAL(CaptureState::FailedNoSamples, capture.state());
}

static void test_too_few_samples_in_the_window_fails_as_no_samples() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  capture.addSample(400, 1.0f, 0.0f, 9.81f);
  capture.addSample(800, 1.0f, 0.0f, 9.81f);
  capture.addSample(1000, 1.0f, 0.0f, 9.81f);
  TEST_ASSERT_EQUAL(CaptureState::FailedNoSamples, capture.state());
}

static void test_a_failed_capture_keeps_the_previous_result_readable() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  feedStillWindow(capture, 0, 2.0f);
  capture.start(2000, true);
  capture.addSample(2020, 30.0f, 3.0f, 9.81f);
  TEST_ASSERT_EQUAL(CaptureState::FailedMotion, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 2.0f, capture.meanDeg());
}

static void test_samples_after_finishing_are_ignored() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  feedStillWindow(capture, 0, 2.0f);
  capture.addSample(1100, 40.0f, 5.0f, 20.0f);
  TEST_ASSERT_EQUAL(CaptureState::Succeeded, capture.state());
}

// ── tiltFromAngle ─────────────────────────────────────────────────────────

static void test_uncalibrated_boot_uses_the_default_range() {
  TiltCalibration calibration;
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, tiltFromAngle(0.0f, calibration, LIMITS));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, tiltFromAngle(30.0f, calibration, LIMITS));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, -1.0f, tiltFromAngle(-30.0f, calibration, LIMITS));
}

static void test_tilt_is_exactly_zero_inside_the_dead_zone() {
  TiltCalibration calibration;
  calibration.neutralSet = true;
  calibration.neutralDeg = 5.0f;
  TEST_ASSERT_EQUAL_FLOAT(0.0f, tiltFromAngle(5.0f, calibration, LIMITS));
  TEST_ASSERT_EQUAL_FLOAT(0.0f, tiltFromAngle(7.9f, calibration, LIMITS));
  TEST_ASSERT_EQUAL_FLOAT(0.0f, tiltFromAngle(2.1f, calibration, LIMITS));
  TEST_ASSERT_TRUE(tiltFromAngle(8.5f, calibration, LIMITS) > 0.0f);
}

static TiltCalibration threePoses() {
  TiltCalibration calibration;
  calibration.neutralSet = true;
  calibration.neutralDeg = 5.0f;
  calibration.heelSet = true;
  calibration.heelDeg = -15.0f;
  calibration.toeSet = true;
  calibration.toeDeg = 45.0f;
  return calibration;
}

static void test_each_pose_lands_on_its_tilt() {
  const TiltCalibration calibration = threePoses();
  TEST_ASSERT_FLOAT_WITHIN(0.001f, -1.0f, tiltFromAngle(-15.0f, calibration, LIMITS));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, tiltFromAngle(5.0f, calibration, LIMITS));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, tiltFromAngle(45.0f, calibration, LIMITS));
}

static void test_each_side_scales_on_its_own_range() {
  const TiltCalibration calibration = threePoses();
  // Toe side: 40 degrees, less the 3 degree dead zone, so halfway is 21.5 past neutral.
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.5f, tiltFromAngle(26.5f, calibration, LIMITS));
  // Heel side: 20 degrees, less the dead zone, so halfway is 11.5 below neutral.
  TEST_ASSERT_FLOAT_WITHIN(0.001f, -0.5f, tiltFromAngle(-6.5f, calibration, LIMITS));
}

static void test_tilt_saturates_beyond_the_poses() {
  const TiltCalibration calibration = threePoses();
  TEST_ASSERT_EQUAL_FLOAT(1.0f, tiltFromAngle(80.0f, calibration, LIMITS));
  TEST_ASSERT_EQUAL_FLOAT(-1.0f, tiltFromAngle(-80.0f, calibration, LIMITS));
}

static void test_a_skipped_side_keeps_the_default_range() {
  TiltCalibration calibration;
  calibration.neutralSet = true;
  calibration.toeSet = true;
  calibration.toeDeg = 15.0f;
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, tiltFromAngle(15.0f, calibration, LIMITS));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, -1.0f, tiltFromAngle(-30.0f, calibration, LIMITS));
}

static void test_a_backward_controller_corrects_itself() {
  // Mounted the other way round, toe-down reads as a smaller angle.
  TiltCalibration calibration;
  calibration.neutralSet = true;
  calibration.toeSet = true;
  calibration.toeDeg = -20.0f;
  calibration.heelSet = true;
  calibration.heelDeg = 20.0f;
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, tiltFromAngle(-20.0f, calibration, LIMITS));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, -1.0f, tiltFromAngle(20.0f, calibration, LIMITS));
}

static void test_one_pose_is_enough_to_set_the_direction() {
  TiltCalibration calibration;
  calibration.neutralSet = true;
  calibration.heelSet = true;
  calibration.heelDeg = 20.0f;
  // Heel is above neutral, so toe-down must be below it, at the default range.
  TEST_ASSERT_FLOAT_WITHIN(0.001f, -1.0f, tiltFromAngle(20.0f, calibration, LIMITS));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, tiltFromAngle(-30.0f, calibration, LIMITS));
}

// ── applyPose ─────────────────────────────────────────────────────────────

static void test_neutral_applies_and_rejects_far_from_level() {
  TiltCalibration calibration;
  TEST_ASSERT_NULL(applyPose(calibration, CalibrationPose::Neutral, 6.0f, LIMITS));
  TEST_ASSERT_TRUE(calibration.neutralSet);
  TEST_ASSERT_EQUAL_FLOAT(6.0f, calibration.neutralDeg);

  TEST_ASSERT_EQUAL_STRING("out-of-range", applyPose(calibration, CalibrationPose::Neutral, 60.0f, LIMITS));
  TEST_ASSERT_EQUAL_FLOAT(6.0f, calibration.neutralDeg);
}

static void test_heel_and_toe_may_go_past_the_neutral_limit() {
  TiltCalibration calibration;
  TEST_ASSERT_NULL(applyPose(calibration, CalibrationPose::Toe, 70.0f, LIMITS));
  TEST_ASSERT_TRUE(calibration.toeSet);
  TEST_ASSERT_EQUAL_FLOAT(70.0f, calibration.toeDeg);
}

static void test_a_pose_too_close_to_neutral_is_rejected() {
  TiltCalibration calibration;
  TEST_ASSERT_EQUAL_STRING("too-close", applyPose(calibration, CalibrationPose::Toe, 9.0f, LIMITS));
  TEST_ASSERT_FALSE(calibration.toeSet);
  TEST_ASSERT_EQUAL_STRING("too-close", applyPose(calibration, CalibrationPose::Heel, -9.0f, LIMITS));
  TEST_ASSERT_FALSE(calibration.heelSet);
}

static void test_heel_and_toe_must_be_on_opposite_sides() {
  TiltCalibration calibration;
  TEST_ASSERT_NULL(applyPose(calibration, CalibrationPose::Toe, 20.0f, LIMITS));
  TEST_ASSERT_EQUAL_STRING("wrong-side", applyPose(calibration, CalibrationPose::Heel, 25.0f, LIMITS));
  TEST_ASSERT_FALSE(calibration.heelSet);
  TEST_ASSERT_NULL(applyPose(calibration, CalibrationPose::Heel, -20.0f, LIMITS));
  TEST_ASSERT_EQUAL_STRING("wrong-side", applyPose(calibration, CalibrationPose::Toe, -30.0f, LIMITS));
  TEST_ASSERT_EQUAL_FLOAT(20.0f, calibration.toeDeg);
}

static void test_retaking_neutral_keeps_the_other_poses() {
  TiltCalibration calibration = threePoses();
  TEST_ASSERT_NULL(applyPose(calibration, CalibrationPose::Neutral, 8.0f, LIMITS));
  TEST_ASSERT_TRUE(calibration.heelSet);
  TEST_ASSERT_TRUE(calibration.toeSet);
  TEST_ASSERT_EQUAL_FLOAT(-15.0f, calibration.heelDeg);
  TEST_ASSERT_EQUAL_FLOAT(45.0f, calibration.toeDeg);
}

static void test_neutral_landing_past_a_pose_resets_that_side() {
  TiltCalibration calibration = threePoses();
  TEST_ASSERT_NULL(applyPose(calibration, CalibrationPose::Neutral, -20.0f, LIMITS));
  TEST_ASSERT_FALSE(calibration.heelSet);
  TEST_ASSERT_TRUE(calibration.toeSet);
}

static void test_neutral_landing_too_near_a_pose_resets_that_side() {
  TiltCalibration calibration = threePoses();
  TEST_ASSERT_NULL(applyPose(calibration, CalibrationPose::Neutral, 40.0f, LIMITS));
  TEST_ASSERT_FALSE(calibration.toeSet);
  TEST_ASSERT_TRUE(calibration.heelSet);
}

static void test_retaking_neutral_keeps_a_backward_mounts_direction() {
  TiltCalibration calibration;
  TEST_ASSERT_NULL(applyPose(calibration, CalibrationPose::Toe, -20.0f, LIMITS));
  TEST_ASSERT_NULL(applyPose(calibration, CalibrationPose::Heel, 20.0f, LIMITS));
  TEST_ASSERT_NULL(applyPose(calibration, CalibrationPose::Neutral, 2.0f, LIMITS));
  TEST_ASSERT_TRUE(calibration.toeSet);
  TEST_ASSERT_TRUE(calibration.heelSet);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, tiltFromAngle(-20.0f, calibration, LIMITS));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_still_boot_captures_its_average_angle);
  RUN_TEST(test_small_wobble_is_averaged_not_rejected);
  RUN_TEST(test_a_steep_pose_can_be_captured);
  RUN_TEST(test_capture_does_not_finish_before_the_window_ends);
  RUN_TEST(test_rotation_fails_as_motion);
  RUN_TEST(test_acceleration_away_from_gravity_fails_as_motion);
  RUN_TEST(test_slow_drift_past_the_range_fails_as_motion);
  RUN_TEST(test_unavailable_sensor_fails_immediately);
  RUN_TEST(test_samples_stopping_fails_as_no_samples);
  RUN_TEST(test_too_few_samples_in_the_window_fails_as_no_samples);
  RUN_TEST(test_a_failed_capture_keeps_the_previous_result_readable);
  RUN_TEST(test_samples_after_finishing_are_ignored);
  RUN_TEST(test_uncalibrated_boot_uses_the_default_range);
  RUN_TEST(test_tilt_is_exactly_zero_inside_the_dead_zone);
  RUN_TEST(test_each_pose_lands_on_its_tilt);
  RUN_TEST(test_each_side_scales_on_its_own_range);
  RUN_TEST(test_tilt_saturates_beyond_the_poses);
  RUN_TEST(test_a_skipped_side_keeps_the_default_range);
  RUN_TEST(test_a_backward_controller_corrects_itself);
  RUN_TEST(test_one_pose_is_enough_to_set_the_direction);
  RUN_TEST(test_neutral_applies_and_rejects_far_from_level);
  RUN_TEST(test_heel_and_toe_may_go_past_the_neutral_limit);
  RUN_TEST(test_a_pose_too_close_to_neutral_is_rejected);
  RUN_TEST(test_heel_and_toe_must_be_on_opposite_sides);
  RUN_TEST(test_retaking_neutral_keeps_the_other_poses);
  RUN_TEST(test_neutral_landing_past_a_pose_resets_that_side);
  RUN_TEST(test_neutral_landing_too_near_a_pose_resets_that_side);
  RUN_TEST(test_retaking_neutral_keeps_a_backward_mounts_direction);
  return UNITY_END();
}
