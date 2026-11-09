// The same physical boot motion must produce the same tilt with any chip mounting.
#include <unity.h>
#include "firewalker_orientation.h"
using namespace Firewalker;
void setUp() {} void tearDown() {}
static void arbitrary_mount_learns_boot_axis() {
  // This rigid basis distributes boot pitch over all three sensor axes.
  const Vec3 up = unit({1, 2, 3});
  const Vec3 forward = unit(cross(up, {0, 0, 1}));
  OrientationCalibration calibration;
  const auto pose = [&](float degrees) { const float a = degrees * 0.0174532925f; return up * cosf(a) + forward * sinf(a); };
  TEST_ASSERT_NULL(applyOrientationPose(calibration, CalibrationPose::Neutral, pose(0), {30, 3, 10, 30}));
  TEST_ASSERT_NULL(applyOrientationPose(calibration, CalibrationPose::Heel, pose(-25), {30, 3, 10, 30}));
  TEST_ASSERT_NULL(applyOrientationPose(calibration, CalibrationPose::Toe, pose(35), {30, 3, 10, 30}));
  TEST_ASSERT_TRUE(orientationCalibrated(calibration));
  TEST_ASSERT_FLOAT_WITHIN(.001f, 0, orientationTilt(pose(0), calibration, {30, 3, 10, 30}));
  TEST_ASSERT_FLOAT_WITHIN(.001f, -1, orientationTilt(pose(-25), calibration, {30, 3, 10, 30}));
  TEST_ASSERT_FLOAT_WITHIN(.001f, 1, orientationTilt(pose(35), calibration, {30, 3, 10, 30}));
  TEST_ASSERT_FLOAT_WITHIN(.001f, .5f, orientationTilt(pose(19), calibration, {30, 3, 10, 30}));
}
static void fusion_tracks_pitch_on_all_three_chip_axes() {
  const Vec3 up = unit({1, 2, 3});
  const Vec3 seed = {1,-2,4};
  const Vec3 axis = unit(seed-up*dot(seed,up));
  GravityFusion filter;
  filter.update(up * 9.81f, {}, 0, .96f, 9.81f, 2.0f);
  // Gravity moves opposite the chip's measured rotation; a pure gyro step must
  // already follow that movement, without waiting for accelerometer correction.
  const Vec3 expected = up * cosf(.2f) + cross(axis, up) * -sinf(.2f);
  filter.update(expected * 9.81f, axis * 2.0f, .1f, 1.0f, 9.81f, 2.0f);
  TEST_ASSERT_FLOAT_WITHIN(.001f, 0, vectorAngleDeg(filter.gravity(), expected));
}
static void capture_saves_a_3d_pose_and_can_clear_it() {
  const Vec3 up = unit({1,2,3}), f = unit(cross(up,{0,0,1}));
  OrientationCalibration c;
  OrientationCalibrator capture({2000,500,50,8}, {30,3,10,30});
  const auto hold = [&](CalibrationPose pose, Vec3 g, uint32_t start) {
    TEST_ASSERT_NULL(capture.start(pose,start,true));
    capture.update(start,c);
    for (uint32_t t=20; t<=2000; t+=20) capture.addSample(start+t,g);
    TEST_ASSERT_EQUAL(CaptureReportKind::Applied,capture.update(start+2000,c).kind);
  };
  hold(CalibrationPose::Neutral,up,0);
  TEST_ASSERT_FALSE(orientationCalibrated(c));
  hold(CalibrationPose::Toe,up*.8660254f+f*.5f,3000);
  TEST_ASSERT_TRUE(orientationCalibrated(c));
  TEST_ASSERT_NULL(capture.clear(CalibrationClear::Toe,c));
  TEST_ASSERT_FALSE(c.toeSet);
  TEST_ASSERT_TRUE(c.neutralSet);
}

// Independent Euler rotation used only by the test rig to remount the chip.
static Vec3 mount(Vec3 v, float x, float y, float z) {
  Vec3 a={v.x, v.y*cosf(x)-v.z*sinf(x), v.y*sinf(x)+v.z*cosf(x)};
  Vec3 b={a.x*cosf(y)+a.z*sinf(y), a.y, -a.x*sinf(y)+a.z*cosf(y)};
  return {b.x*cosf(z)-b.y*sinf(z), b.x*sinf(z)+b.y*cosf(z), b.z};
}
static void same_boot_motion_is_invariant_under_arbitrary_mounting() {
  const OrientationLimits limits={30,3,10,30};
  for (int i=0;i<48;i++) {
    const float x=i*.43f, y=i*.79f, z=i*1.31f;
    const auto pose=[&](float angle) { return mount({sinf(angle*.0174532925f),0,cosf(angle*.0174532925f)},x,y,z); };
    OrientationCalibration c;
    TEST_ASSERT_NULL(applyOrientationPose(c,CalibrationPose::Neutral,pose(0),limits));
    TEST_ASSERT_NULL(applyOrientationPose(c,CalibrationPose::Heel,pose(-25),limits));
    TEST_ASSERT_NULL(applyOrientationPose(c,CalibrationPose::Toe,pose(35),limits));
    GravityFusion fusion;
    fusion.update(pose(-25)*9.81f,{},0,.96f,9.81f,2);
    for (int step=1;step<=60;step++) {
      const float angle=-25+step;
      fusion.update(pose(angle)*9.81f,mount({0,-.8726646f,0},x,y,z),.02f,.96f,9.81f,2);
      TEST_ASSERT_FLOAT_WITHIN(.02f,angle,orientationDegrees(fusion.gravity(),c));
    }
    TEST_ASSERT_FLOAT_WITHIN(.001f,.5f,orientationTilt(pose(19),c,limits));
    // Rolling sideways around the learned fore-aft direction stays at neutral.
    TEST_ASSERT_FLOAT_WITHIN(.001f,0,orientationTilt(mount({0,.5f,.8660254f},x,y,z),c,limits));
  }
}
static void neutral_retake_requires_new_side_poses() {
  OrientationCalibration c;
  const OrientationLimits limits={30,3,10,30};
  applyOrientationPose(c,CalibrationPose::Neutral,{0,0,1},limits);
  applyOrientationPose(c,CalibrationPose::Toe,{.5f,0,.8660254f},limits);
  TEST_ASSERT_TRUE(orientationCalibrated(c));
  applyOrientationPose(c,CalibrationPose::Neutral,{1,0,0},limits);
  TEST_ASSERT_FALSE(c.toeSet);
  TEST_ASSERT_FALSE(orientationCalibrated(c));
  TEST_ASSERT_EQUAL_FLOAT(0,orientationTilt({1,0,0},c,limits));
}
static void capture_rejects_rocking_and_stale_samples() {
  OrientationCalibration c;
  OrientationCalibrator capture({2000,500,50,8},{30,3,10,30});
  capture.start(CalibrationPose::Neutral,0,true); capture.update(0,c);
  for (uint32_t t=20;t<=2000;t+=20) capture.addSample(t,{(t%40)?-.5f:.5f,0,.8660254f});
  const auto result=capture.update(2000,c);
  TEST_ASSERT_EQUAL(CaptureReportKind::Failed,result.kind);
  TEST_ASSERT_EQUAL_STRING("motion",result.reason);
  TEST_ASSERT_FALSE(c.neutralSet);
  capture.start(CalibrationPose::Neutral,3000,true); capture.update(3000,c);
  TEST_ASSERT_EQUAL_STRING("no-samples",capture.update(3500,c).reason);
}
static void gyro_tracks_through_an_impact_without_treating_it_as_gravity() {
  GravityFusion fusion;
  fusion.update({0,0,9.81f},{},0,.96f,9.81f,2);
  fusion.update({30,0,0},{},.02f,.96f,9.81f,2);
  TEST_ASSERT_FLOAT_WITHIN(.0001f,1,fusion.gravity().z);
  TEST_ASSERT_FLOAT_WITHIN(.0001f,0,fusion.gravity().x);
}
static void side_poses_validate_direction_and_plane() {
  OrientationCalibration c;
  const OrientationLimits limits={30,3,10,30};
  TEST_ASSERT_EQUAL_STRING("neutral-required",applyOrientationPose(c,CalibrationPose::Heel,{0,0,1},limits));
  applyOrientationPose(c,CalibrationPose::Neutral,{0,0,1},limits);
  TEST_ASSERT_EQUAL_STRING("too-close",applyOrientationPose(c,CalibrationPose::Heel,{0,0,1},limits));
  applyOrientationPose(c,CalibrationPose::Toe,{.5f,0,.8660254f},limits);
  TEST_ASSERT_EQUAL_STRING("wrong-side",applyOrientationPose(c,CalibrationPose::Heel,{.5f,0,.8660254f},limits));
  TEST_ASSERT_EQUAL_STRING("off-axis",applyOrientationPose(c,CalibrationPose::Heel,{-.1f,.5f,.8660254f},limits));
  TEST_ASSERT_FALSE(c.heelSet);
}
static void clear_all_is_persistent_geometry_reset_and_refuses_during_capture() {
  OrientationCalibration c;
  OrientationCalibrator capture({2000,500,50,8},{30,3,10,30});
  applyOrientationPose(c,CalibrationPose::Neutral,{0,0,1},{30,3,10,30});
  applyOrientationPose(c,CalibrationPose::Heel,{-.5f,0,.8660254f},{30,3,10,30});
  capture.start(CalibrationPose::Toe,0,true);
  TEST_ASSERT_EQUAL_STRING("already-capturing",capture.clear(CalibrationClear::All,c));
  TEST_ASSERT_TRUE(c.heelSet);
  capture.update(500,c);
  TEST_ASSERT_NULL(capture.clear(CalibrationClear::All,c));
  TEST_ASSERT_FALSE(c.neutralSet);
  TEST_ASSERT_FALSE(c.heelSet);
  TEST_ASSERT_EQUAL_STRING("idle",capture.statusText());
  TEST_ASSERT_EQUAL(CaptureReportKind::None,capture.update(600,c).kind);
}
static void capture_tolerates_a_brief_stumble_on_an_arbitrary_mount() {
  OrientationCalibration c;
  OrientationCalibrator capture({2000,500,50,8},{30,3,10,30});
  const Vec3 held=unit({1,2,3});
  capture.start(CalibrationPose::Neutral,0,true); capture.update(0,c);
  for(uint32_t t=20;t<=2000;t+=20) capture.addSample(t,t<260?Vec3{-1,0,0}:held);
  TEST_ASSERT_EQUAL(CaptureReportKind::Applied,capture.update(2000,c).kind);
  TEST_ASSERT_FLOAT_WITHIN(.0001f,held.x,c.neutral.x);
  TEST_ASSERT_FLOAT_WITHIN(.0001f,held.y,c.neutral.y);
  TEST_ASSERT_FLOAT_WITHIN(.0001f,held.z,c.neutral.z);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(arbitrary_mount_learns_boot_axis);
  RUN_TEST(fusion_tracks_pitch_on_all_three_chip_axes);
  RUN_TEST(capture_saves_a_3d_pose_and_can_clear_it);
  RUN_TEST(same_boot_motion_is_invariant_under_arbitrary_mounting);
  RUN_TEST(neutral_retake_requires_new_side_poses);
  RUN_TEST(capture_rejects_rocking_and_stale_samples);
  RUN_TEST(gyro_tracks_through_an_impact_without_treating_it_as_gravity);
  RUN_TEST(side_poses_validate_direction_and_plane);
  RUN_TEST(clear_all_is_persistent_geometry_reset_and_refuses_during_capture);
  RUN_TEST(capture_tolerates_a_brief_stumble_on_an_arbitrary_mount);
  return UNITY_END();
}
