// IMU service for the XIAO MG24 Sense's onboard LSM6DS3TR-C, implementing the
// shared Firewalker::imu* contract (firewalker_imu.h) so the board-agnostic flow
// pattern runs unchanged. This mirrors src/firewalker_imu.cpp (the Feather /
// MPU-6050 implementation) but differs in three board-specific ways:
//
//   * Sensor + bus: an LSM6DS3 over I2C 0x6A on the default Wire bus. The onboard
//     IMU is powered by its enable pin (PD5), driven HIGH before begin().
//   * Units: the LSM6DS3 library returns accel in g and gyro in deg/s, while the
//     fusion math and the config.h thresholds are metric/radian (like the MPU
//     path). We convert g -> m/s^2 and deg/s -> rad/s on read, so every config.h
//     knob (stomp thresholds, filter alpha, full-tilt degrees) is reused as-is.
//   * Mount map: firewalker_mg24_mount.h owns the MG24 axes, signs, and neutral
//     trim, separately from config.h's GY-521 mount. Its gyro direction agrees
//     with the acceleration-derived angle, so quick tilts are predicted in the
//     right direction before the accelerometer corrects slower drift. The
//     native MG24 mount tests replay that relationship without sensor hardware.
#include "firewalker_imu.h"

#include <LSM6DS3.h>
#include <Wire.h>
#include <math.h>

#include "config.h"
#include "firewalker_fusion.h"
#include "firewalker_mg24_mount.h"

namespace Firewalker {

// LSM6DS3 unit conversions into the fusion's expected units. (DEG_TO_RAD is
// already provided as a macro by the Arduino core's Common.h, so reuse it.)
static constexpr float G_TO_MPS2 = 9.80665f;

static constexpr uint8_t LSM6DS3_ADDR = 0x6A;
// IMU power-enable pin (variant pin table: "IMU enable"). Gate the sensor on
// before begin().
#ifndef XIAO_IMU_ENABLE_PIN
#define XIAO_IMU_ENABLE_PIN PD5
#endif

static LSM6DS3 imu(I2C_MODE, LSM6DS3_ADDR);
static bool ready = false;
static ImuSample latest = {0, 0, 0, 0, 0, 0, IMU_GRAVITY};

// Fused fore-aft tilt (radians, 0 = level) via the pure fuseTiltStep() filter.
static float fusedAngle = 0.0f;
static bool firstSample = true;

static StompState stomp;

static unsigned long lastSampleMs = 0;
static unsigned long lastLogMs = 0;

bool imuBegin() {
  pinMode(XIAO_IMU_ENABLE_PIN, OUTPUT);
  digitalWrite(XIAO_IMU_ENABLE_PIN, HIGH);  // power the onboard IMU
  delay(10);

  ready = (imu.begin() == 0);
  if (ready) {
    Serial.print(F("[firewalker] LSM6DS3 ready @0x"));
    Serial.println(LSM6DS3_ADDR, HEX);
  } else {
    Serial.println(
        F("[firewalker] LSM6DS3 NOT found — check PD5 enable / Wire / 0x6A"));
  }

  Serial.print(F("[firewalker] imu stomp |a|>="));
  Serial.print(IMU_STOMP_ACCEL_THRESHOLD);
  Serial.print(F(" release<="));
  Serial.print(IMU_RELEASE_ACCEL_THRESHOLD);
  Serial.print(F(" mount(fwd="));
  Serial.print(Mg24Mount::FOREAFT_AXIS);
  Serial.print(F(" up="));
  Serial.print(Mg24Mount::VERTICAL_AXIS);
  Serial.print(F(" gyro="));
  Serial.print(Mg24Mount::PITCH_GYRO_AXIS);
  Serial.println(F(")"));
  return ready;
}

bool imuReady() { return ready; }

bool imuUpdate() {
  if (!ready) return false;

  unsigned long now = millis();
  if ((now - lastSampleMs) < IMU_SAMPLE_MS) return false;
  float dt = firstSample ? 0.0f : (now - lastSampleMs) / 1000.0f;
  lastSampleMs = now;

  // Read + convert to the fusion's units (m/s^2, rad/s).
  latest.ax = imu.readFloatAccelX() * G_TO_MPS2;
  latest.ay = imu.readFloatAccelY() * G_TO_MPS2;
  latest.az = imu.readFloatAccelZ() * G_TO_MPS2;
  latest.gx = imu.readFloatGyroX() * DEG_TO_RAD;
  latest.gy = imu.readFloatGyroY() * DEG_TO_RAD;
  latest.gz = imu.readFloatGyroZ() * DEG_TO_RAD;
  latest.mag = sqrtf(latest.ax * latest.ax + latest.ay * latest.ay +
                     latest.az * latest.az);

  // Complementary filter for fore-aft tilt (pure math in firewalker_fusion.h).
  float aFwd = Mg24Mount::foreAftAcceleration(latest.ax, latest.ay, latest.az);
  float aUp = Mg24Mount::verticalAcceleration(latest.ax, latest.ay, latest.az);
  float accAngle = accelTiltAngle(aFwd, aUp);
  float gyroRate = Mg24Mount::pitchAngularRate(latest.gx, latest.gy, latest.gz);
  if (firstSample) {
    fusedAngle = accAngle;
    firstSample = false;
  } else {
    fusedAngle =
        fuseTiltStep(fusedAngle, accAngle, gyroRate, dt, IMU_FILTER_ALPHA);
  }

  // Stomp hysteresis + refractory (pure stompStep() in firewalker_fusion.h).
  stompStep(stomp, latest.mag, now,
            {IMU_STOMP_ACCEL_THRESHOLD, IMU_RELEASE_ACCEL_THRESHOLD,
             IMU_REFRACTORY_MS});

  return true;
}

const ImuSample& imuLatest() { return latest; }

float imuTiltFwd() {
  float trimmed = fusedAngle - Mg24Mount::FOREAFT_REST_DEG * DEG_TO_RAD;
  return normalizeTilt(trimmed, IMU_TILT_FULL_DEG);
}

bool imuTakeStomp() {
  if (!stomp.pending) return false;
  stomp.pending = false;
  return true;
}

float imuStompStrength() {
  float s = (stomp.fireMag - IMU_STOMP_ACCEL_THRESHOLD) /
            (IMU_STOMP_FORCE_FULL - IMU_STOMP_ACCEL_THRESHOLD);
  if (s < 0.0f) s = 0.0f;
  if (s > 1.0f) s = 1.0f;
  return s;
}

void imuLog() {
  unsigned long now = millis();
  if ((now - lastLogMs) < IMU_LOG_MS) return;
  lastLogMs = now;

  Serial.print(F("[imu] a=("));
  Serial.print(latest.ax, 2);
  Serial.print(',');
  Serial.print(latest.ay, 2);
  Serial.print(',');
  Serial.print(latest.az, 2);
  Serial.print(F(") |a|="));
  Serial.print(latest.mag, 2);
  Serial.print(F(" g=("));
  Serial.print(latest.gx, 2);
  Serial.print(',');
  Serial.print(latest.gy, 2);
  Serial.print(',');
  Serial.print(latest.gz, 2);
  Serial.print(F(") tilt="));
  Serial.print(imuTiltFwd(), 2);
  Serial.print(F(" armed="));
  Serial.println(stomp.armed ? F("true") : F("false"));
}

}  // namespace Firewalker
