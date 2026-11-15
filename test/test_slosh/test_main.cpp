// Native tests of the slosh signal (include/firewalker_slosh.h): the imaginary water that the
// boot's motion throws toward the heel or the toe.
//
// Two things are checked. sloshPull has to get its signs right for any chip mounting, since a
// flipped sign would send the water the wrong way on every boot and nothing else would catch it.
// sloshStep has to behave like water: thrown, overshooting, settling, and never stuck or broken
// by a bad sample. The designer's copy of the water has the same tests in
// designer/src/sim/slosh.test.ts.
#include <math.h>
#include <unity.h>

#include "firewalker_slosh.h"

using namespace Firewalker;

void setUp() {}
void tearDown() {}

static const float G = 9.81f;
static const float RADIANS = 0.0174532925f;
static const OrientationLimits LIMITS = {30, 3, 10, 30};
// The same numbers as SLOSH_PARAMS in config.h, which can't be included off-hardware.
static const SloshParams P = {1.6f, 0.35f, 1.5f, 0.6f, 2.5f, 0.05f};
static const float SAMPLE = 0.02f;  // IMU_SAMPLE_MS

// How the chip sits on the boot: the boot's toe-ward and upward directions in chip coordinates.
struct Mount {
  Vec3 toeward, up;
};

// A chip lying flat and square, and one tipped so the boot's axes spread over all three of its own.
static Mount flatMount() { return {{1, 0, 0}, {0, 0, 1}}; }
static Mount tippedMount() {
  const Vec3 up = unit({1, 2, 3});
  return {unit(cross(up, {0, 0, 1})), up};
}

// What the motion sensor reads, in m/s^2, for a boot pitched `pitchDeg` (toe down is positive)
// whose speed along the foot is changing by `towardToeG` (positive while it speeds up toward the
// toe, negative while it brakes). This is physics, not the code under test: a resting sensor
// reads one g straight up, and speeding up adds a reading in the direction of travel.
static Vec3 reading(const Mount& m, float pitchDeg, float towardToeG) {
  const float a = pitchDeg * RADIANS;
  const Vec3 worldUp = m.toeward * -sinf(a) + m.up * cosf(a);
  return worldUp * G + m.toeward * (towardToeG * G);
}

// Teaches the boot its poses the way the app does: neutral, then a held heel and toe.
static OrientationCalibration calibrated(const Mount& m) {
  OrientationCalibration c;
  TEST_ASSERT_NULL(applyOrientationPose(c, CalibrationPose::Neutral, reading(m, 0, 0), LIMITS));
  TEST_ASSERT_NULL(applyOrientationPose(c, CalibrationPose::Heel, reading(m, -25, 0), LIMITS));
  TEST_ASSERT_NULL(applyOrientationPose(c, CalibrationPose::Toe, reading(m, 30, 0), LIMITS));
  return c;
}

// The pull for a boot held at `pitchDeg` long enough for the fused gravity to have settled there.
static SloshPull pullAt(const Mount& m, float pitchDeg, float towardToeG) {
  return sloshPull(reading(m, pitchDeg, towardToeG), unit(reading(m, pitchDeg, 0)), calibrated(m), G);
}

static void check_signs_for(const Mount& m) {
  // Tilting pours toward the low end, by the share of gravity that runs along the foot.
  TEST_ASSERT_FLOAT_WITHIN(0.01f, sinf(20 * RADIANS), pullAt(m, 20, 0).pourG);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, -sinf(20 * RADIANS), pullAt(m, -20, 0).pourG);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 0, pullAt(m, 20, 0).pushG);

  // Moving off leaves the water behind at the heel, and braking throws it to the toe.
  TEST_ASSERT_FLOAT_WITHIN(0.01f, -0.5f, pullAt(m, 0, 0.5f).pushG);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 1.0f, pullAt(m, 0, -1.0f).pushG);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 0, pullAt(m, 0, 0.5f).pourG);

  // Both at once stay separate: a tilted boot that brakes reports its tilt and its braking.
  const SloshPull both = pullAt(m, 20, -1.0f);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, sinf(20 * RADIANS), both.pourG);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 1.0f, both.pushG);
}

static void test_pulls_have_the_right_sign_on_a_flat_chip() { check_signs_for(flatMount()); }
static void test_pulls_have_the_right_sign_on_a_tipped_chip() { check_signs_for(tippedMount()); }

static void test_no_pull_until_the_boot_knows_its_foot() {
  const Mount m = tippedMount();
  const Vec3 braking = reading(m, 20, -1.0f);
  const Vec3 gravity = unit(reading(m, 20, 0));

  // Nothing captured, and neutral alone: no heel or toe pose has said which way the foot points.
  OrientationCalibration c;
  SloshPull pull = sloshPull(braking, gravity, c, G);
  TEST_ASSERT_EQUAL_FLOAT(0, pull.pushG);
  TEST_ASSERT_EQUAL_FLOAT(0, pull.pourG);
  TEST_ASSERT_NULL(applyOrientationPose(c, CalibrationPose::Neutral, reading(m, 0, 0), LIMITS));
  pull = sloshPull(braking, gravity, c, G);
  TEST_ASSERT_EQUAL_FLOAT(0, pull.pushG);
  TEST_ASSERT_EQUAL_FLOAT(0, pull.pourG);

  // Before the first usable sample the fused gravity is still zero.
  pull = sloshPull(braking, {}, calibrated(m), G);
  TEST_ASSERT_EQUAL_FLOAT(0, pull.pushG);
  TEST_ASSERT_EQUAL_FLOAT(0, pull.pourG);
}

// Runs the water for `seconds` under a constant pull. `low` and `high` widen to cover every
// value it took, and the return value is the last one.
static float run(SloshState& state, float pushG, float pourG, float seconds, float& low, float& high) {
  float value = tanhf(state.position);
  for (float t = 0; t < seconds; t += SAMPLE) {
    value = sloshStep(state, pushG, pourG, SAMPLE, P);
    if (value < low) low = value;
    if (value > high) high = value;
  }
  return value;
}

static void test_stays_level_when_nothing_pulls() {
  SloshState state;
  float low = 0, high = 0;
  TEST_ASSERT_EQUAL_FLOAT(0, run(state, 0, 0, 2, low, high));
  TEST_ASSERT_EQUAL_FLOAT(0, low);
  TEST_ASSERT_EQUAL_FLOAT(0, high);
}

static void test_thrown_to_the_heel_while_speeding_up_then_levels_out() {
  SloshState state;
  float low = 0, high = 0;
  run(state, -0.5f, 0, 0.3f, low, high);
  TEST_ASSERT_LESS_THAN_FLOAT(-0.3f, low);
  TEST_ASSERT_FLOAT_WITHIN(0.02f, 0, run(state, 0, 0, 3, low, high));
}

static void test_thrown_to_the_toe_on_a_stop_then_rocks_back_and_settles() {
  SloshState state;
  float low = 0, high = 0;
  run(state, 1, 0, 0.15f, low, high);
  float after = 0;
  const float last = run(state, 0, 0, 3, after, high);
  TEST_ASSERT_GREATER_THAN_FLOAT(0.5f, high);
  // Water overshoots: after the surge to the toe it swings back toward the heel.
  TEST_ASSERT_LESS_THAN_FLOAT(-0.05f, after);
  TEST_ASSERT_FLOAT_WITHIN(0.02f, 0, last);
}

static void test_pours_more_gently_than_it_is_pushed() {
  SloshState pouredState, pushedState;
  float low = 0, high = 0;
  const float poured = run(pouredState, 0, 0.5f, 4, low, high);
  const float pushed = run(pushedState, 0.5f, 0, 4, low, high);
  TEST_ASSERT_GREATER_THAN_FLOAT(0.1f, poured);
  TEST_ASSERT_LESS_THAN_FLOAT(pushed, poured);
}

static void test_stays_in_range_through_spikes_and_bad_samples() {
  SloshState state;
  float low = 0, high = 0;
  run(state, 40, 0, 1, low, high);   // a heel strike far past the ceiling
  run(state, -40, 0, 1, low, high);
  TEST_ASSERT_TRUE(low >= -1.0f && high <= 1.0f);
  TEST_ASSERT_TRUE(fabsf(state.position) <= P.maxPull);

  // A reading or a time step that isn't a number counts as nothing, and the water carries on.
  const float bad = sloshStep(state, NAN, 0, SAMPLE, P);
  TEST_ASSERT_TRUE(isfinite(bad) && fabsf(bad) <= 1.0f);
  const SloshState before = state;
  sloshStep(state, 1, 0, NAN, P);
  TEST_ASSERT_EQUAL_FLOAT(before.position, state.position);
  TEST_ASSERT_EQUAL_FLOAT(before.velocity, state.velocity);
  TEST_ASSERT_FLOAT_WITHIN(0.02f, 0, run(state, 0, 0, 4, low, high));
}

static void test_a_stalled_loop_counts_as_a_short_step() {
  SloshState stalled, normal;
  sloshStep(stalled, 1, 0, 5, P);
  sloshStep(normal, 1, 0, P.maxStepSeconds, P);
  TEST_ASSERT_EQUAL_FLOAT(normal.position, stalled.position);
  TEST_ASSERT_EQUAL_FLOAT(normal.velocity, stalled.velocity);
}

// The whole path the IMU service runs each sample, on a tipped chip: a boot sliding forward
// brakes at one g for a moment, and the water ends up thrown to the toe.
static void test_braking_throws_the_water_to_the_toe_end_to_end() {
  const Mount m = tippedMount();
  const OrientationCalibration c = calibrated(m);
  const Vec3 gravity = unit(reading(m, 0, 0));
  SloshState state;
  float high = 0;
  for (float t = 0; t < 0.15f; t += SAMPLE) {
    const SloshPull pull = sloshPull(reading(m, 0, -1.0f), gravity, c, G);
    high = fmaxf(high, sloshStep(state, pull.pushG, pull.pourG, SAMPLE, P));
  }
  for (float t = 0; t < 0.5f; t += SAMPLE) {
    const SloshPull pull = sloshPull(reading(m, 0, 0), gravity, c, G);
    high = fmaxf(high, sloshStep(state, pull.pushG, pull.pourG, SAMPLE, P));
  }
  TEST_ASSERT_GREATER_THAN_FLOAT(0.5f, high);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_pulls_have_the_right_sign_on_a_flat_chip);
  RUN_TEST(test_pulls_have_the_right_sign_on_a_tipped_chip);
  RUN_TEST(test_no_pull_until_the_boot_knows_its_foot);
  RUN_TEST(test_stays_level_when_nothing_pulls);
  RUN_TEST(test_thrown_to_the_heel_while_speeding_up_then_levels_out);
  RUN_TEST(test_thrown_to_the_toe_on_a_stop_then_rocks_back_and_settles);
  RUN_TEST(test_pours_more_gently_than_it_is_pushed);
  RUN_TEST(test_stays_in_range_through_spikes_and_bad_samples);
  RUN_TEST(test_a_stalled_loop_counts_as_a_short_step);
  RUN_TEST(test_braking_throws_the_water_to_the_toe_end_to_end);
  return UNITY_END();
}
