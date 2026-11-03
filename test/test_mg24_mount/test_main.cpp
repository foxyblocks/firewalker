// Replay rigid rotations using the same MG24 mount mapping and fusion math as
// imu_xiao.cpp. This catches a gyro that fights a fast tilt even though the
// accelerometer eventually pulls the resting angle into the right position.
#include <math.h>
#include <unity.h>

#include "firewalker_fusion.h"
#include "firewalker_mg24_mount.h"

using namespace Firewalker;

void setUp() {}
void tearDown() {}

static void assertFastPitchTracks(float direction) {
  constexpr float dt = 0.02f;
  constexpr float rate = 1.5f;  // rad/s: about 17° of rotation in 200 ms
  constexpr float gravity = 9.80665f;
  float angle = 0.0f;
  float fused = 0.0f;

  for (int sample = 0; sample < 10; ++sample) {
    angle += direction * rate * dt;
    // For positive rotation around sensor Y, the stationary-gravity vector
    // seen by the rotating sensor moves toward -X and away from +Z. The gyro
    // reports +Y, so atan2(accel X, accel Z) changes in the opposite direction.
    const float ax = -sinf(angle) * gravity;
    const float az = cosf(angle) * gravity;
    const float measured = accelTiltAngle(
        Mg24Mount::foreAftAcceleration(ax, 0.0f, az),
        Mg24Mount::verticalAcceleration(ax, 0.0f, az));
    const float gyro = Mg24Mount::pitchAngularRate(0.0f, direction * rate, 0.0f);
    fused = fuseTiltStep(fused, measured, gyro, dt, 0.96f);
    // Require the estimate to follow during the movement, not just converge
    // seconds later once the controller stops. Two degrees allows rounding.
    TEST_ASSERT_FLOAT_WITHIN(0.035f, measured, fused);
  }
}

static void test_fast_positive_pitch_tracks_without_settling_delay() {
  assertFastPitchTracks(+1.0f);
}

static void test_fast_negative_pitch_tracks_without_settling_delay() {
  assertFastPitchTracks(-1.0f);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_fast_positive_pitch_tracks_without_settling_delay);
  RUN_TEST(test_fast_negative_pitch_tracks_without_settling_delay);
  return UNITY_END();
}
