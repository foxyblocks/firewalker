// Native tests of acceleration-magnitude stomp detection. Orientation regression
// tests live in test_orientation and remount the chip throughout 3D space.
#include <unity.h>
#include "firewalker_fusion.h"
using namespace Firewalker;
void setUp() {} void tearDown() {}
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
  RUN_TEST(test_stomp_fires_once_on_spike);
  RUN_TEST(test_stomp_rearms_only_below_release);
  RUN_TEST(test_stomp_refractory_blocks_rapid_refire);
  RUN_TEST(test_stomp_below_threshold_never_fires);
  return UNITY_END();
}
