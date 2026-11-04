// Native (off-hardware) tests for the strip ring-geometry math:
// include/firewalker_strip_map.h — the pixel→fore-aft position map, the arc/unwrap
// helpers flow uses for trail fronts, and the rules for changing a saved layout. Run
// with `pio test -e native`.
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
  TEST_ASSERT_EQUAL_UINT16(20, stripToeToHeelLen(N, TOE, HEEL));
  TEST_ASSERT_EQUAL_UINT16(20, stripHeelToToeLen(N, TOE, HEEL));
  TEST_ASSERT_EQUAL_UINT16(N, stripToeToHeelLen(N, TOE, HEEL) + stripHeelToToeLen(N, TOE, HEEL));
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
  for (uint16_t u = HEEL; u < HEEL + stripHeelToToeLen(N, TOE, HEEL); u++) {
    float here = stripForeAft(stripWrapIndex(u, N), N, TOE, HEEL);
    float next = stripForeAft(stripWrapIndex(u + 1, N), N, TOE, HEEL);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 1.0f / 20.0f, next - here);
  }
}

// ── The 160-pixel FCOB strip's bench layout ─────────────────────────────

static void test_fcob_layout_has_two_equal_arcs() {
  TEST_ASSERT_EQUAL_UINT16(80, stripToeToHeelLen(160, 52, 132));
  TEST_ASSERT_EQUAL_UINT16(80, stripHeelToToeLen(160, 52, 132));
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

// ── A strip wound the other way, so the heel comes first ────────────────
//
// Pixel 0 on a 40-pixel ring, running back to the heel at 7, then forward along the
// other side to the toe at 27. A mirrored boot lands here with the same controller mount.

static void test_mirrored_layout_anchors_the_toe_and_heel() {
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 1.0f, stripForeAft(27, N, 27, 7));
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.0f, stripForeAft(7, N, 27, 7));
}

static void test_mirrored_layout_arcs_partition_the_ring() {
  // Toe up to the heel wraps through the index seam: 27→39→0→7 is 20 steps.
  TEST_ASSERT_EQUAL_UINT16(20, stripToeToHeelLen(N, 27, 7));
  TEST_ASSERT_EQUAL_UINT16(20, stripHeelToToeLen(N, 27, 7));
}

static void test_mirrored_layout_climbs_from_heel_to_toe_by_index() {
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.05f, stripForeAft(8, N, 27, 7));
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.95f, stripForeAft(26, N, 27, 7));
  // Past the toe, the fore-aft position falls again across the seam back to the heel.
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.95f, stripForeAft(28, N, 27, 7));
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.35f, stripForeAft(0, N, 27, 7));
}

static void test_uneven_arcs_each_scale_to_the_full_range() {
  // A 3-step arc and a 7-step arc on a 10-pixel ring: toe at 2, heel at 5.
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 2.0f / 3.0f, stripForeAft(3, 10, 2, 5));
  TEST_ASSERT_FLOAT_WITHIN(1e-6f, 1.0f / 7.0f, stripForeAft(6, 10, 2, 5));
}

// ── Layout rules ─────────────────────────────────────────────────────────

static constexpr uint16_t MAX_PIXELS = 160;

static void test_layout_validity() {
  TEST_ASSERT_TRUE(stripLayoutValid({160, 52, 132}, MAX_PIXELS));
  TEST_ASSERT_TRUE(stripLayoutValid({110, 90, 30}, MAX_PIXELS));  // heel first is fine
  TEST_ASSERT_TRUE(stripLayoutValid({2, 0, 1}, MAX_PIXELS));      // the smallest ring
  TEST_ASSERT_FALSE(stripLayoutValid({161, 52, 132}, MAX_PIXELS));
  TEST_ASSERT_FALSE(stripLayoutValid({1, 0, 0}, MAX_PIXELS));
  TEST_ASSERT_FALSE(stripLayoutValid({110, 50, 50}, MAX_PIXELS));
  TEST_ASSERT_FALSE(stripLayoutValid({110, 110, 50}, MAX_PIXELS));
  TEST_ASSERT_FALSE(stripLayoutValid({110, 50, 110}, MAX_PIXELS));
}

static void test_setting_toe_or_heel_moves_only_that_marker() {
  StripLayout layout = {110, 40, 90};
  TEST_ASSERT_NULL(applyStripSetting(layout, StripField::Toe, 45, MAX_PIXELS));
  TEST_ASSERT_EQUAL_UINT16(45, layout.toe);
  TEST_ASSERT_EQUAL_UINT16(90, layout.heel);
  TEST_ASSERT_NULL(applyStripSetting(layout, StripField::Heel, 100, MAX_PIXELS));
  TEST_ASSERT_EQUAL_UINT16(45, layout.toe);
  TEST_ASSERT_EQUAL_UINT16(100, layout.heel);
  TEST_ASSERT_EQUAL_UINT16(110, layout.count);
}

static void test_toe_may_move_past_the_heel() {
  StripLayout layout = {110, 40, 90};
  TEST_ASSERT_NULL(applyStripSetting(layout, StripField::Toe, 100, MAX_PIXELS));
  TEST_ASSERT_EQUAL_UINT16(100, layout.toe);
}

static void test_rejected_settings_leave_the_layout_alone() {
  StripLayout layout = {110, 40, 90};
  TEST_ASSERT_EQUAL_STRING("same-pixel", applyStripSetting(layout, StripField::Toe, 90, MAX_PIXELS));
  TEST_ASSERT_EQUAL_STRING("same-pixel", applyStripSetting(layout, StripField::Heel, 40, MAX_PIXELS));
  TEST_ASSERT_EQUAL_STRING("out-of-range", applyStripSetting(layout, StripField::Toe, 110, MAX_PIXELS));
  TEST_ASSERT_EQUAL_STRING("out-of-range", applyStripSetting(layout, StripField::Heel, 110, MAX_PIXELS));
  TEST_ASSERT_EQUAL_STRING("out-of-range", applyStripSetting(layout, StripField::Count, 1, MAX_PIXELS));
  TEST_ASSERT_EQUAL_STRING("out-of-range", applyStripSetting(layout, StripField::Count, 161, MAX_PIXELS));
  TEST_ASSERT_EQUAL_UINT16(110, layout.count);
  TEST_ASSERT_EQUAL_UINT16(40, layout.toe);
  TEST_ASSERT_EQUAL_UINT16(90, layout.heel);
}

static void test_growing_the_count_keeps_toe_and_heel() {
  StripLayout layout = {110, 40, 90};
  TEST_ASSERT_NULL(applyStripSetting(layout, StripField::Count, 160, MAX_PIXELS));
  TEST_ASSERT_EQUAL_UINT16(160, layout.count);
  TEST_ASSERT_EQUAL_UINT16(40, layout.toe);
  TEST_ASSERT_EQUAL_UINT16(90, layout.heel);
}

static void test_cutting_the_count_pulls_in_a_marker_past_the_end() {
  // The first-boot layout on a strip cut to 110: the heel no longer exists at 132.
  StripLayout layout = {160, 52, 132};
  TEST_ASSERT_NULL(applyStripSetting(layout, StripField::Count, 110, MAX_PIXELS));
  TEST_ASSERT_EQUAL_UINT16(110, layout.count);
  TEST_ASSERT_EQUAL_UINT16(52, layout.toe);
  TEST_ASSERT_EQUAL_UINT16(109, layout.heel);
}

static void test_cutting_the_count_keeps_markers_apart_and_in_order() {
  StripLayout toeFirst = {160, 52, 132};
  TEST_ASSERT_NULL(applyStripSetting(toeFirst, StripField::Count, 20, MAX_PIXELS));
  TEST_ASSERT_EQUAL_UINT16(18, toeFirst.toe);
  TEST_ASSERT_EQUAL_UINT16(19, toeFirst.heel);

  StripLayout heelFirst = {160, 132, 52};
  TEST_ASSERT_NULL(applyStripSetting(heelFirst, StripField::Count, 20, MAX_PIXELS));
  TEST_ASSERT_EQUAL_UINT16(19, heelFirst.toe);
  TEST_ASSERT_EQUAL_UINT16(18, heelFirst.heel);

  StripLayout smallest = {160, 52, 132};
  TEST_ASSERT_NULL(applyStripSetting(smallest, StripField::Count, 2, MAX_PIXELS));
  TEST_ASSERT_TRUE(stripLayoutValid(smallest, MAX_PIXELS));
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
  RUN_TEST(test_mirrored_layout_anchors_the_toe_and_heel);
  RUN_TEST(test_mirrored_layout_arcs_partition_the_ring);
  RUN_TEST(test_mirrored_layout_climbs_from_heel_to_toe_by_index);
  RUN_TEST(test_uneven_arcs_each_scale_to_the_full_range);
  RUN_TEST(test_layout_validity);
  RUN_TEST(test_setting_toe_or_heel_moves_only_that_marker);
  RUN_TEST(test_toe_may_move_past_the_heel);
  RUN_TEST(test_rejected_settings_leave_the_layout_alone);
  RUN_TEST(test_growing_the_count_keeps_toe_and_heel);
  RUN_TEST(test_cutting_the_count_pulls_in_a_marker_past_the_end);
  RUN_TEST(test_cutting_the_count_keeps_markers_apart_and_in_order);
  return UNITY_END();
}
