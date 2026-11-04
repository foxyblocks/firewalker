// Native (off-hardware) tests for the strip ring-geometry math:
// include/firewalker_strip_map.h — the pixel→fore-aft position map and the
// arc/unwrap helpers flow uses for trail fronts. Run with `pio test -e native`.
//
// Most constants use the small 40-pixel ring, whose numbers are easy to check by hand:
// pixel 0 under the controller, toe apex at 13, heel at 33. The FCOB strip's bench
// layout has its own cases below.

#include <unity.h>

#include "firewalker_strip_map.h"

using namespace Firewalker;

static constexpr uint16_t N    = 40;
static constexpr uint16_t TOE  = 13;
static constexpr uint16_t HEEL = 33;

void setUp() {}
void tearDown() {}

// ── arc helpers ───────────────────────────────────────────────────────────

static void test_arc_lengths_partition_the_ring() {
  // 13→33 plain = 20 steps; 33→39→0→13 through the wrap
  // = 20 steps. Together they cover the whole 40-pixel ring.
  TEST_ASSERT_EQUAL_UINT16(20, stripPlainArcLen(TOE, HEEL));
  TEST_ASSERT_EQUAL_UINT16(20, stripWrapArcLen(N, TOE, HEEL));
  TEST_ASSERT_EQUAL_UINT16(N, stripPlainArcLen(TOE, HEEL) + stripWrapArcLen(N, TOE, HEEL));
}

static void test_wrap_index_folds_unwrapped_positions() {
  TEST_ASSERT_EQUAL_UINT16(33, stripWrapIndex(33, N));   // below count: identity
  TEST_ASSERT_EQUAL_UINT16(0, stripWrapIndex(40, N));    // one past the end
  TEST_ASSERT_EQUAL_UINT16(13, stripWrapIndex(53, N));   // unwrapped toe = real toe
}

// ── stripForeAft: anchors ────────────────────────────────────────────────

static void test_toe_is_one_heel_is_zero() {
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 1.0f, stripForeAft(TOE, N, TOE, HEEL));
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.0f, stripForeAft(HEEL, N, TOE, HEEL));
}

static void test_strip_start_sits_behind_midfoot() {
  // Pixel 0 (under the controller) is 7 wrap-steps past the heel
  // of a 20-step arc → s = 0.35, between heel and mid-foot.
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.35f, stripForeAft(0, N, TOE, HEEL));
}

static void test_known_wrap_arc_positions() {
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.05f, stripForeAft(34, N, TOE, HEEL));  // 1 past heel
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.30f, stripForeAft(39, N, TOE, HEEL));  // last pixel
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.95f, stripForeAft(12, N, TOE, HEEL));  // 1 short of toe
}

// ── stripForeAft: shape over the whole ring ─────────────────────────────

static void test_plain_arc_descends_linearly_toe_to_heel() {
  for (uint16_t i = TOE; i < HEEL; i++) {
    float here = stripForeAft(i, N, TOE, HEEL);
    float next = stripForeAft(i + 1, N, TOE, HEEL);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 1.0f / 20.0f, here - next);
  }
}

static void test_wrap_arc_ascends_linearly_heel_to_toe() {
  // Walk the wrap arc heel→toe in unwrapped coordinates (33..53); s must
  // climb by exactly one step each pixel, including across the 39→0 wrap.
  for (uint16_t u = HEEL; u < HEEL + stripWrapArcLen(N, TOE, HEEL); u++) {
    float here = stripForeAft(stripWrapIndex(u, N), N, TOE, HEEL);
    float next = stripForeAft(stripWrapIndex(u + 1, N), N, TOE, HEEL);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 1.0f / 20.0f, next - here);
  }
}

// ── The 160-pixel FCOB strip's bench layout ─────────────────────────────

static void test_fcob_layout_has_two_equal_arcs() {
  TEST_ASSERT_EQUAL_UINT16(80, stripPlainArcLen(52, 132));
  TEST_ASSERT_EQUAL_UINT16(80, stripWrapArcLen(160, 52, 132));
}

static void test_fcob_layout_anchors_and_wrap() {
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 1.0f, stripForeAft(52, 160, 52, 132));
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.0f, stripForeAft(132, 160, 52, 132));
  // Pixel 0 sits 28 wrap-steps past the heel of an 80-step arc: the same 0.35 as the
  // 40-pixel ring, because this layout scales that ring by four.
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.35f, stripForeAft(0, 160, 52, 132));
  TEST_ASSERT_EQUAL_UINT16(52, stripWrapIndex(212, 160));  // unwrapped toe = real toe
}

static void test_all_pixels_in_unit_range() {
  for (uint16_t i = 0; i < N; i++) {
    float s = stripForeAft(i, N, TOE, HEEL);
    TEST_ASSERT_TRUE(s >= 0.0f);
    TEST_ASSERT_TRUE(s <= 1.0f);
  }
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_arc_lengths_partition_the_ring);
  RUN_TEST(test_wrap_index_folds_unwrapped_positions);
  RUN_TEST(test_toe_is_one_heel_is_zero);
  RUN_TEST(test_strip_start_sits_behind_midfoot);
  RUN_TEST(test_known_wrap_arc_positions);
  RUN_TEST(test_plain_arc_descends_linearly_toe_to_heel);
  RUN_TEST(test_wrap_arc_ascends_linearly_heel_to_toe);
  RUN_TEST(test_fcob_layout_has_two_equal_arcs);
  RUN_TEST(test_fcob_layout_anchors_and_wrap);
  RUN_TEST(test_all_pixels_in_unit_range);
  return UNITY_END();
}
