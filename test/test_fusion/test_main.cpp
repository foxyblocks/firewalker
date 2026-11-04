// Native (off-hardware) tests for the IMU module's pure math:
// include/firewalker_fusion.h — complementary-filter tilt fusion and stomp
// hysteresis. Run with `pio test -e native`.
//
// These pin down the behaviors the bench-calibration checklist
// (docs/open-questions.md) tunes: filter alpha, stomp thresholds, refractory.

#include <unity.h>

#include "firewalker_fusion.h"

using namespace Firewalker;

void setUp() {}
void tearDown() {}

// ── accelTiltAngle ────────────────────────────────────────────────────────

static void test_accel_angle_level_is_zero() {
  // Board level: gravity entirely on the vertical axis.
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.0f, accelTiltAngle(0.0f, 9.81f));
}

static void test_accel_angle_45_degrees() {
  // Gravity split evenly between fore-aft and vertical → 45°.
  float a = 9.81f * 0.7071f;
  TEST_ASSERT_FLOAT_WITHIN(1e-4f, (float)M_PI / 4.0f, accelTiltAngle(a, a));
}

static void test_accel_angle_sign_follows_foreaft() {
  TEST_ASSERT_TRUE(accelTiltAngle(3.0f, 9.0f) > 0.0f);   // toe-down → +
  TEST_ASSERT_TRUE(accelTiltAngle(-3.0f, 9.0f) < 0.0f);  // heel-down → -
}

// ── fuseTiltStep ──────────────────────────────────────────────────────────

static void test_fusion_converges_to_accel_angle_at_rest() {
  // Still board (gyro 0), constant accel angle: the fused angle must converge
  // to the accelerometer's absolute angle regardless of where it started.
  float fused = 0.0f;
  const float target = 0.5f;  // rad
  for (int i = 0; i < 600; i++) {  // 600 steps @20 ms = 12 s
    fused = fuseTiltStep(fused, target, 0.0f, 0.02f, 0.96f);
  }
  TEST_ASSERT_FLOAT_WITHIN(1e-3f, target, fused);
}

static void test_fusion_integrates_gyro_when_alpha_is_one() {
  // alpha = 1 → pure gyro integration: angle accumulates rate * dt.
  float fused = 0.0f;
  for (int i = 0; i < 50; i++) {
    fused = fuseTiltStep(fused, 0.0f, 0.4f, 0.02f, 1.0f);
  }
  TEST_ASSERT_FLOAT_WITHIN(1e-4f, 0.4f * 0.02f * 50.0f, fused);
}

static void test_fusion_single_step_blend() {
  // One step from level with a disagreeing accel angle: exactly the
  // complementary blend.
  float fused = fuseTiltStep(0.2f, 0.6f, 0.0f, 0.02f, 0.96f);
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.96f * 0.2f + 0.04f * 0.6f, fused);
}

// ── stompStep hysteresis ──────────────────────────────────────────────────

static const StompParams P = {18.0f, 12.0f, 250};  // fire / re-arm / refractory

static void test_stomp_fires_once_on_spike() {
  StompState s;
  stompStep(s, 25.0f, 1000, P);  // spike
  TEST_ASSERT_TRUE(s.pending);
  TEST_ASSERT_FALSE(s.armed);

  s.pending = false;             // consumed (imuTakeStomp)
  stompStep(s, 25.0f, 1020, P);  // still high — must NOT refire
  TEST_ASSERT_FALSE(s.pending);
}

static void test_stomp_rearms_only_below_release() {
  StompState s;
  stompStep(s, 25.0f, 1000, P);
  s.pending = false;

  stompStep(s, 15.0f, 1300, P);  // between release (12) and fire (18)
  TEST_ASSERT_FALSE(s.armed);    // not low enough to re-arm

  stompStep(s, 10.0f, 1400, P);  // below release
  TEST_ASSERT_TRUE(s.armed);

  stompStep(s, 25.0f, 1500, P);  // next spike fires again
  TEST_ASSERT_TRUE(s.pending);
}

static void test_stomp_refractory_blocks_rapid_refire() {
  StompState s;
  stompStep(s, 25.0f, 1000, P);  // fire @1000
  s.pending = false;
  stompStep(s, 10.0f, 1050, P);  // re-armed quickly
  TEST_ASSERT_TRUE(s.armed);

  stompStep(s, 25.0f, 1100, P);  // spike inside the 250 ms refractory gap
  TEST_ASSERT_FALSE(s.pending);

  stompStep(s, 25.0f, 1251, P);  // past the gap (still armed, still high)
  TEST_ASSERT_TRUE(s.pending);
}

static void test_stomp_below_threshold_never_fires() {
  StompState s;
  for (uint32_t t = 0; t < 5000; t += 20) stompStep(s, 17.9f, t, P);
  TEST_ASSERT_FALSE(s.pending);
  TEST_ASSERT_TRUE(s.armed);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_accel_angle_level_is_zero);
  RUN_TEST(test_accel_angle_45_degrees);
  RUN_TEST(test_accel_angle_sign_follows_foreaft);
  RUN_TEST(test_fusion_converges_to_accel_angle_at_rest);
  RUN_TEST(test_fusion_integrates_gyro_when_alpha_is_one);
  RUN_TEST(test_fusion_single_step_blend);
  RUN_TEST(test_stomp_fires_once_on_spike);
  RUN_TEST(test_stomp_rearms_only_below_release);
  RUN_TEST(test_stomp_refractory_blocks_rapid_refire);
  RUN_TEST(test_stomp_below_threshold_never_fires);
  return UNITY_END();
}
