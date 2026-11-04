// Native (off-hardware) tests for where fire-trail bands run:
// include/firewalker_trail_path.h. Each origin's fronts have to start at the part of the
// boot that's down and finish at the opposite part, on either side of the foot, whichever
// way the ring runs. Run with `pio test -e native -f test_trail_path`.
//
// The main layout is the uncut bench strip: 160 pixels, toe at 52, heel at 132, so each
// side of the foot is 80 steps long, and one side crosses the seam from pixel 159 to 0.

#include <unity.h>

#include "firewalker_trail_path.h"

using namespace Firewalker;

static constexpr float FLAT_DEG = 8.0f;
static constexpr StripLayout BENCH = {160, 52, 132};
static constexpr StripLayout MIRRORED = {160, 132, 52};
static constexpr StripLayout UNEVEN = {110, 40, 100};  // 60 steps one way, 50 the other

void setUp() {}
void tearDown() {}

static uint16_t lastPixel(const TrailFront& front, uint16_t count) {
  return trailFrontPixel(front, front.length, count);
}

// ── picking the origin from tilt ──────────────────────────────────────────

static void test_a_big_tilt_picks_the_end_that_is_down() {
  TEST_ASSERT_TRUE(trailOriginFromTilt(30.0f, FLAT_DEG) == TrailOrigin::Toe);
  TEST_ASSERT_TRUE(trailOriginFromTilt(-30.0f, FLAT_DEG) == TrailOrigin::Heel);
}

static void test_level_picks_the_middle() {
  TEST_ASSERT_TRUE(trailOriginFromTilt(0.0f, FLAT_DEG) == TrailOrigin::Middle);
}

static void test_the_whole_tolerance_counts_as_flat() {
  TEST_ASSERT_TRUE(trailOriginFromTilt(7.9f, FLAT_DEG) == TrailOrigin::Middle);
  TEST_ASSERT_TRUE(trailOriginFromTilt(-7.9f, FLAT_DEG) == TrailOrigin::Middle);
  TEST_ASSERT_TRUE(trailOriginFromTilt(8.0f, FLAT_DEG) == TrailOrigin::Middle);
  TEST_ASSERT_TRUE(trailOriginFromTilt(-8.0f, FLAT_DEG) == TrailOrigin::Middle);
}

static void test_just_past_the_tolerance_picks_that_end() {
  TEST_ASSERT_TRUE(trailOriginFromTilt(8.1f, FLAT_DEG) == TrailOrigin::Toe);
  TEST_ASSERT_TRUE(trailOriginFromTilt(-8.1f, FLAT_DEG) == TrailOrigin::Heel);
}

// ── toe down and heel down ────────────────────────────────────────────────

static void test_toe_down_runs_both_sides_from_toe_to_heel() {
  const TrailPath path = trailPath(BENCH, TrailOrigin::Toe);
  TEST_ASSERT_EQUAL_UINT8(2, path.frontCount);
  for (uint8_t i = 0; i < path.frontCount; i++) {
    TEST_ASSERT_EQUAL_UINT16(BENCH.toe, trailFrontPixel(path.fronts[i], 0, BENCH.count));
    TEST_ASSERT_EQUAL_UINT16(BENCH.heel, lastPixel(path.fronts[i], BENCH.count));
  }
  TEST_ASSERT_TRUE(path.fronts[0].dir != path.fronts[1].dir);
}

static void test_heel_down_runs_both_sides_from_heel_to_toe() {
  const TrailPath path = trailPath(BENCH, TrailOrigin::Heel);
  TEST_ASSERT_EQUAL_UINT8(2, path.frontCount);
  for (uint8_t i = 0; i < path.frontCount; i++) {
    TEST_ASSERT_EQUAL_UINT16(BENCH.heel, trailFrontPixel(path.fronts[i], 0, BENCH.count));
    TEST_ASSERT_EQUAL_UINT16(BENCH.toe, lastPixel(path.fronts[i], BENCH.count));
  }
  TEST_ASSERT_TRUE(path.fronts[0].dir != path.fronts[1].dir);
}

// ── flat ──────────────────────────────────────────────────────────────────

static void test_flat_starts_halfway_along_each_side() {
  // Halfway from toe 52 up to heel 132 is 92. Halfway from heel 132 up past the seam to
  // toe 52 is 12.
  const TrailPath path = trailPath(BENCH, TrailOrigin::Middle);
  TEST_ASSERT_EQUAL_UINT8(4, path.frontCount);
  TEST_ASSERT_EQUAL_UINT16(92, path.fronts[0].start);
  TEST_ASSERT_EQUAL_UINT16(92, path.fronts[1].start);
  TEST_ASSERT_EQUAL_UINT16(12, path.fronts[2].start);
  TEST_ASSERT_EQUAL_UINT16(12, path.fronts[3].start);
}

static void test_flat_runs_outward_to_both_toe_and_heel() {
  const TrailPath path = trailPath(BENCH, TrailOrigin::Middle);
  uint8_t reachedToe = 0;
  uint8_t reachedHeel = 0;
  for (uint8_t i = 0; i < path.frontCount; i++) {
    const uint16_t end = lastPixel(path.fronts[i], BENCH.count);
    if (end == BENCH.toe) reachedToe++;
    if (end == BENCH.heel) reachedHeel++;
  }
  TEST_ASSERT_EQUAL_UINT8(2, reachedToe);
  TEST_ASSERT_EQUAL_UINT8(2, reachedHeel);
}

// ── walking the ring ──────────────────────────────────────────────────────

static void test_front_folds_across_the_seam() {
  // The toe's descending front runs 52, 51, ... 0, then on to 159.
  const TrailPath path = trailPath(BENCH, TrailOrigin::Toe);
  const TrailFront& descending = (path.fronts[0].dir < 0) ? path.fronts[0] : path.fronts[1];
  TEST_ASSERT_EQUAL_UINT16(51, trailFrontPixel(descending, 1, BENCH.count));
  TEST_ASSERT_EQUAL_UINT16(0, trailFrontPixel(descending, 52, BENCH.count));
  TEST_ASSERT_EQUAL_UINT16(159, trailFrontPixel(descending, 53, BENCH.count));
}

static void test_mirrored_ring_still_runs_toe_to_heel() {
  // A mirrored boot has its heel at a lower index than its toe.
  const TrailPath path = trailPath(MIRRORED, TrailOrigin::Toe);
  for (uint8_t i = 0; i < path.frontCount; i++) {
    TEST_ASSERT_EQUAL_UINT16(MIRRORED.toe, trailFrontPixel(path.fronts[i], 0, MIRRORED.count));
    TEST_ASSERT_EQUAL_UINT16(MIRRORED.heel, lastPixel(path.fronts[i], MIRRORED.count));
  }
}

static void test_uneven_sides_each_reach_the_far_end() {
  const TrailPath path = trailPath(UNEVEN, TrailOrigin::Heel);
  for (uint8_t i = 0; i < path.frontCount; i++) {
    TEST_ASSERT_EQUAL_UINT16(UNEVEN.toe, lastPixel(path.fronts[i], UNEVEN.count));
  }
  TEST_ASSERT_EQUAL_UINT16(60, path.longest);
}

static void test_longest_is_the_longest_front_for_flat() {
  // Halving 60 and 50 leaves 30 steps as the longest run outward.
  TEST_ASSERT_EQUAL_UINT16(30, trailPath(UNEVEN, TrailOrigin::Middle).longest);
}

// Every pixel of the ring has to light, and no front can land outside it, including on the
// smallest rings where a side has no pixels of its own to halve.
static void assert_covers_the_whole_ring(const StripLayout& layout, TrailOrigin origin) {
  bool seen[160] = {};
  const TrailPath path = trailPath(layout, origin);
  for (uint8_t i = 0; i < path.frontCount; i++) {
    for (uint16_t steps = 0; steps <= path.fronts[i].length; steps++) {
      const uint16_t pixel = trailFrontPixel(path.fronts[i], steps, layout.count);
      TEST_ASSERT_LESS_THAN_UINT16(layout.count, pixel);
      seen[pixel] = true;
    }
  }
  for (uint16_t pixel = 0; pixel < layout.count; pixel++) TEST_ASSERT_TRUE(seen[pixel]);
}

static void test_every_origin_covers_every_pixel() {
  const StripLayout layouts[] = {BENCH, MIRRORED, UNEVEN, {3, 0, 1}, {2, 0, 1}, {2, 1, 0}, {5, 4, 0}};
  const TrailOrigin origins[] = {TrailOrigin::Heel, TrailOrigin::Middle, TrailOrigin::Toe};
  for (const StripLayout& layout : layouts) {
    for (TrailOrigin origin : origins) assert_covers_the_whole_ring(layout, origin);
  }
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_a_big_tilt_picks_the_end_that_is_down);
  RUN_TEST(test_level_picks_the_middle);
  RUN_TEST(test_the_whole_tolerance_counts_as_flat);
  RUN_TEST(test_just_past_the_tolerance_picks_that_end);
  RUN_TEST(test_toe_down_runs_both_sides_from_toe_to_heel);
  RUN_TEST(test_heel_down_runs_both_sides_from_heel_to_toe);
  RUN_TEST(test_flat_starts_halfway_along_each_side);
  RUN_TEST(test_flat_runs_outward_to_both_toe_and_heel);
  RUN_TEST(test_front_folds_across_the_seam);
  RUN_TEST(test_mirrored_ring_still_runs_toe_to_heel);
  RUN_TEST(test_uneven_sides_each_reach_the_far_end);
  RUN_TEST(test_longest_is_the_longest_front_for_flat);
  RUN_TEST(test_every_origin_covers_every_pixel);
  return UNITY_END();
}
