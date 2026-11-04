// Native (off-hardware) tests for tilt calibration: include/firewalker_calibration.h. A
// capture has to find the pose in a wobbly hold and refuse a boot that never settles, the
// three poses have to map onto -1, 0, and +1, and a rejected pose can never disturb a good
// calibration. Run with `pio test -e native`.
#include <unity.h>

#include "firewalker_calibration.h"

using namespace Firewalker;

static const PoseCaptureLimits CAPTURE = {
    2000,  // windowMs
    500,   // noSampleMs
    50,    // minSamples
    8.0f,  // maxSpreadDeg
};

static const TiltLimits LIMITS = {
    30.0f,  // defaultRangeDeg
    3.0f,   // deadzoneDeg
    10.0f,  // minSideDeg
    45.0f,  // maxNeutralDeg
};

void setUp() {}
void tearDown() {}

// Feeds a whole window of identical samples at 50 Hz, the sensor's rate.
static void feedHold(PoseCapture& capture, uint32_t startMs, float angleDeg) {
  for (uint32_t t = 20; t <= CAPTURE.windowMs; t += 20) {
    capture.addSample(startMs + t, angleDeg);
  }
}

// ── PoseCapture ───────────────────────────────────────────────────────────

static void test_still_boot_captures_its_angle() {
  PoseCapture capture(CAPTURE);
  capture.start(1000, true);
  TEST_ASSERT_TRUE(capture.capturing());
  feedHold(capture, 1000, 4.0f);
  TEST_ASSERT_EQUAL(CaptureState::Succeeded, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 4.0f, capture.angleDeg());
}

static void test_a_wobbling_hold_captures_its_middle() {
  // A foot held up by muscle trembles a few degrees either side of the pose.
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  for (uint32_t t = 20; t <= CAPTURE.windowMs; t += 20) {
    capture.addSample(t, (t % 40 == 0) ? 17.0f : 23.0f);
  }
  TEST_ASSERT_EQUAL(CaptureState::Succeeded, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.5f, 20.0f, capture.angleDeg());
}

static void test_a_brief_jolt_does_not_move_the_result() {
  // A quarter of a second of something much further off, as a stumble would give. The
  // average of all the samples would land near 23 degrees here.
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  for (uint32_t t = 20; t <= CAPTURE.windowMs; t += 20) {
    capture.addSample(t, (t >= 800 && t < 1050) ? 45.0f : 20.0f);
  }
  TEST_ASSERT_EQUAL(CaptureState::Succeeded, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 20.0f, capture.angleDeg());
}

static void test_settling_into_the_pose_late_still_captures_it() {
  // The first third of the window is spent arriving at the pose, sweeping from 0 to 30.
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  for (uint32_t t = 20; t <= CAPTURE.windowMs; t += 20) {
    const float arriving = 30.0f * (float)t / 660.0f;
    capture.addSample(t, (t < 660) ? arriving : 30.0f);
  }
  TEST_ASSERT_EQUAL(CaptureState::Succeeded, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(1.0f, 30.0f, capture.angleDeg());
}

static void test_slow_sag_lands_in_the_middle_of_the_sag() {
  // A tiring foot sinking from 24 to 18 degrees over the whole hold.
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  for (uint32_t t = 20; t <= CAPTURE.windowMs; t += 20) {
    capture.addSample(t, 24.0f - 6.0f * (float)t / (float)CAPTURE.windowMs);
  }
  TEST_ASSERT_EQUAL(CaptureState::Succeeded, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.5f, 21.0f, capture.angleDeg());
}

static void test_rocking_back_and_forth_fails_as_motion() {
  // Swinging between heel and toe has no one pose to capture.
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  for (uint32_t t = 20; t <= CAPTURE.windowMs; t += 20) {
    capture.addSample(t, (t % 400 < 200) ? -20.0f : 20.0f);
  }
  TEST_ASSERT_EQUAL(CaptureState::FailedMotion, capture.state());
}

static void test_a_bad_moment_does_not_end_the_capture_early() {
  // The whole point of judging at the end: a wild first sample leaves time to recover.
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  capture.addSample(20, 80.0f);
  TEST_ASSERT_TRUE(capture.capturing());
}

static void test_a_steep_pose_can_be_captured() {
  // The neutral limit belongs to applyPose, so a capture itself takes any angle.
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  feedHold(capture, 0, 70.0f);
  TEST_ASSERT_EQUAL(CaptureState::Succeeded, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 70.0f, capture.angleDeg());
}

static void test_capture_does_not_finish_before_the_window_ends() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  capture.addSample(CAPTURE.windowMs - 20, 1.0f);
  TEST_ASSERT_TRUE(capture.capturing());
}

static void test_unavailable_sensor_fails_immediately() {
  PoseCapture capture(CAPTURE);
  capture.start(0, false);
  TEST_ASSERT_EQUAL(CaptureState::FailedUnavailable, capture.state());
}

static void test_samples_stopping_fails_as_no_samples() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  capture.addSample(20, 1.0f);
  capture.poll(200);
  TEST_ASSERT_TRUE(capture.capturing());
  capture.poll(520);
  TEST_ASSERT_EQUAL(CaptureState::FailedNoSamples, capture.state());
}

static void test_too_few_samples_in_the_window_fails_as_no_samples() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  for (uint32_t t = 400; t <= CAPTURE.windowMs; t += 400) {
    capture.addSample(t, 1.0f);
  }
  TEST_ASSERT_EQUAL(CaptureState::FailedNoSamples, capture.state());
}

static void test_more_samples_than_the_buffer_holds_still_finishes() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  for (uint32_t t = 1; t <= CAPTURE.windowMs; t += 1) {
    capture.addSample(t, 5.0f);
  }
  TEST_ASSERT_EQUAL(CaptureState::Succeeded, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 5.0f, capture.angleDeg());
}

static void test_a_failed_capture_keeps_the_previous_result_readable() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  feedHold(capture, 0, 2.0f);
  capture.start(3000, true);
  for (uint32_t t = 20; t <= CAPTURE.windowMs; t += 20) {
    capture.addSample(3000 + t, (t % 400 < 200) ? -20.0f : 20.0f);
  }
  TEST_ASSERT_EQUAL(CaptureState::FailedMotion, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 2.0f, capture.angleDeg());
}

static void test_samples_after_finishing_are_ignored() {
  PoseCapture capture(CAPTURE);
  capture.start(0, true);
  feedHold(capture, 0, 2.0f);
  capture.addSample(CAPTURE.windowMs + 100, 40.0f);
  TEST_ASSERT_EQUAL(CaptureState::Succeeded, capture.state());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 2.0f, capture.angleDeg());
}

// ── PoseCalibrator ────────────────────────────────────────────────────────

// Runs a capture through a full window at one angle, then returns the report it ends with.
// The first update reports the start, and the last one reports the outcome.
static CaptureReport holdPose(PoseCalibrator& calibrator, TiltCalibration& calibration, CalibrationPose pose,
                              uint32_t startMs, float angleDeg) {
  calibrator.start(pose, startMs, true);
  calibrator.update(startMs, calibration);
  for (uint32_t t = 20; t <= CAPTURE.windowMs; t += 20) {
    calibrator.addSample(startMs + t, angleDeg);
  }
  return calibrator.update(startMs + CAPTURE.windowMs, calibration);
}

static void rockThroughWindow(PoseCalibrator& calibrator, uint32_t startMs) {
  for (uint32_t t = 20; t <= CAPTURE.windowMs; t += 20) {
    calibrator.addSample(startMs + t, (t % 400 < 200) ? -20.0f : 20.0f);
  }
}

static void test_calibrator_starts_idle_with_nothing_to_report() {
  PoseCalibrator calibrator(CAPTURE, LIMITS);
  TiltCalibration calibration;
  TEST_ASSERT_EQUAL_STRING("idle", calibrator.statusText());
  TEST_ASSERT_EQUAL(CaptureReportKind::None, calibrator.update(0, calibration).kind);
}

static void test_a_new_capture_never_shows_the_previous_result() {
  // A status line can go out in the same loop pass as a capture's ack, before the next
  // update. If it still read "ok", a client would take that as this capture's result.
  PoseCalibrator calibrator(CAPTURE, LIMITS);
  TiltCalibration calibration;
  holdPose(calibrator, calibration, CalibrationPose::Neutral, 0, 2.0f);
  TEST_ASSERT_EQUAL_STRING("ok", calibrator.statusText());

  TEST_ASSERT_NULL(calibrator.start(CalibrationPose::Heel, 3000, true));
  TEST_ASSERT_EQUAL_STRING("capturing", calibrator.statusText());
}

static void test_a_start_is_reported_once() {
  PoseCalibrator calibrator(CAPTURE, LIMITS);
  TiltCalibration calibration;
  calibrator.start(CalibrationPose::Toe, 0, true);
  const CaptureReport report = calibrator.update(0, calibration);
  TEST_ASSERT_EQUAL(CaptureReportKind::Started, report.kind);
  TEST_ASSERT_EQUAL(CalibrationPose::Toe, report.pose);
  TEST_ASSERT_EQUAL(CaptureReportKind::None, calibrator.update(20, calibration).kind);
}

static void test_a_held_pose_is_applied_and_reported() {
  PoseCalibrator calibrator(CAPTURE, LIMITS);
  TiltCalibration calibration;
  const CaptureReport report = holdPose(calibrator, calibration, CalibrationPose::Neutral, 0, 4.0f);
  TEST_ASSERT_EQUAL(CaptureReportKind::Applied, report.kind);
  TEST_ASSERT_EQUAL(CalibrationPose::Neutral, report.pose);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 4.0f, report.angleDeg);
  TEST_ASSERT_TRUE(calibration.neutralSet);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 4.0f, calibration.neutralDeg);
  TEST_ASSERT_EQUAL_STRING("ok", calibrator.statusText());
}

static void test_a_rejected_pose_is_reported_and_changes_nothing() {
  PoseCalibrator calibrator(CAPTURE, LIMITS);
  TiltCalibration calibration;
  holdPose(calibrator, calibration, CalibrationPose::Neutral, 0, 4.0f);
  const CaptureReport report = holdPose(calibrator, calibration, CalibrationPose::Heel, 3000, 6.0f);
  TEST_ASSERT_EQUAL(CaptureReportKind::Failed, report.kind);
  TEST_ASSERT_EQUAL_STRING("too-close", report.reason);
  TEST_ASSERT_EQUAL_STRING("too-close", calibrator.statusText());
  TEST_ASSERT_FALSE(calibration.heelSet);
}

static void test_a_boot_that_never_settles_keeps_its_calibration() {
  PoseCalibrator calibrator(CAPTURE, LIMITS);
  TiltCalibration calibration;
  holdPose(calibrator, calibration, CalibrationPose::Neutral, 0, 4.0f);

  calibrator.start(CalibrationPose::Neutral, 3000, true);
  calibrator.update(3000, calibration);
  rockThroughWindow(calibrator, 3000);
  const CaptureReport report = calibrator.update(5000, calibration);
  TEST_ASSERT_EQUAL(CaptureReportKind::Failed, report.kind);
  TEST_ASSERT_EQUAL_STRING("motion", report.reason);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 4.0f, calibration.neutralDeg);
}

static void test_every_capture_reports_even_when_it_fails_the_same_way() {
  PoseCalibrator calibrator(CAPTURE, LIMITS);
  TiltCalibration calibration;
  for (uint32_t startMs = 0; startMs < 6000; startMs += 3000) {
    calibrator.start(CalibrationPose::Neutral, startMs, true);
    TEST_ASSERT_EQUAL(CaptureReportKind::Started, calibrator.update(startMs, calibration).kind);
    rockThroughWindow(calibrator, startMs);
    TEST_ASSERT_EQUAL(CaptureReportKind::Failed, calibrator.update(startMs + 2000, calibration).kind);
  }
}

static void test_a_missing_sensor_refuses_every_time_and_reports_it() {
  PoseCalibrator calibrator(CAPTURE, LIMITS);
  TiltCalibration calibration;
  for (int attempt = 0; attempt < 2; attempt++) {
    TEST_ASSERT_EQUAL_STRING("sensor-unavailable", calibrator.start(CalibrationPose::Neutral, 0, false));
    TEST_ASSERT_EQUAL_STRING("sensor-unavailable", calibrator.statusText());
    const CaptureReport report = calibrator.update(0, calibration);
    TEST_ASSERT_EQUAL(CaptureReportKind::Failed, report.kind);
    TEST_ASSERT_EQUAL_STRING("sensor-unavailable", report.reason);
  }
}

static void test_a_second_capture_is_refused_and_leaves_the_first_running() {
  PoseCalibrator calibrator(CAPTURE, LIMITS);
  TiltCalibration calibration;
  calibrator.start(CalibrationPose::Neutral, 0, true);
  calibrator.update(0, calibration);

  TEST_ASSERT_EQUAL_STRING("already-capturing", calibrator.start(CalibrationPose::Heel, 100, true));
  TEST_ASSERT_TRUE(calibrator.capturing());
  TEST_ASSERT_EQUAL_STRING("capturing", calibrator.statusText());

  for (uint32_t t = 20; t <= CAPTURE.windowMs; t += 20) calibrator.addSample(t, 4.0f);
  const CaptureReport report = calibrator.update(CAPTURE.windowMs, calibration);
  TEST_ASSERT_EQUAL(CaptureReportKind::Applied, report.kind);
  TEST_ASSERT_EQUAL(CalibrationPose::Neutral, report.pose);
}

static void test_samples_stopping_is_reported() {
  PoseCalibrator calibrator(CAPTURE, LIMITS);
  TiltCalibration calibration;
  calibrator.start(CalibrationPose::Neutral, 0, true);
  calibrator.update(0, calibration);
  const CaptureReport report = calibrator.update(600, calibration);
  TEST_ASSERT_EQUAL(CaptureReportKind::Failed, report.kind);
  TEST_ASSERT_EQUAL_STRING("no-samples", report.reason);
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
  RUN_TEST(test_still_boot_captures_its_angle);
  RUN_TEST(test_a_wobbling_hold_captures_its_middle);
  RUN_TEST(test_a_brief_jolt_does_not_move_the_result);
  RUN_TEST(test_settling_into_the_pose_late_still_captures_it);
  RUN_TEST(test_slow_sag_lands_in_the_middle_of_the_sag);
  RUN_TEST(test_rocking_back_and_forth_fails_as_motion);
  RUN_TEST(test_a_bad_moment_does_not_end_the_capture_early);
  RUN_TEST(test_a_steep_pose_can_be_captured);
  RUN_TEST(test_capture_does_not_finish_before_the_window_ends);
  RUN_TEST(test_unavailable_sensor_fails_immediately);
  RUN_TEST(test_samples_stopping_fails_as_no_samples);
  RUN_TEST(test_too_few_samples_in_the_window_fails_as_no_samples);
  RUN_TEST(test_more_samples_than_the_buffer_holds_still_finishes);
  RUN_TEST(test_a_failed_capture_keeps_the_previous_result_readable);
  RUN_TEST(test_samples_after_finishing_are_ignored);
  RUN_TEST(test_calibrator_starts_idle_with_nothing_to_report);
  RUN_TEST(test_a_new_capture_never_shows_the_previous_result);
  RUN_TEST(test_a_start_is_reported_once);
  RUN_TEST(test_a_held_pose_is_applied_and_reported);
  RUN_TEST(test_a_rejected_pose_is_reported_and_changes_nothing);
  RUN_TEST(test_a_boot_that_never_settles_keeps_its_calibration);
  RUN_TEST(test_every_capture_reports_even_when_it_fails_the_same_way);
  RUN_TEST(test_a_missing_sensor_refuses_every_time_and_reports_it);
  RUN_TEST(test_a_second_capture_is_refused_and_leaves_the_first_running);
  RUN_TEST(test_samples_stopping_is_reported);
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
