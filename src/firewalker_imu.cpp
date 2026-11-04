// Motion service for the MG24 Sense's onboard LSM6DS3TR-C. See firewalker_imu.h for
// the contract. The sensor library reports acceleration in g and rotation in deg/s,
// while the fusion math and the config.h thresholds use m/s^2 and rad/s, so readings
// convert to those units here and nowhere else.
#if !defined(FIREWALKER_LEGACY_FEATHER)

#include "firewalker_imu.h"

#include <LSM6DS3.h>
#include <Wire.h>
#include <math.h>

#include "config.h"
#include "firewalker_fusion.h"
#include "firewalker_mg24_mount.h"

namespace Firewalker {

static constexpr float G_TO_MPS2 = 9.80665f;
static constexpr float DEGREES_TO_RADIANS = 0.0174532925f;

static LSM6DS3 sensor(I2C_MODE, IMU_I2C_ADDR);
static bool ready = false;
static ImuSample latest = {0, 0, 0, 0, 0, 0, IMU_GRAVITY};

// Fused fore-aft angle in radians. Zero is sensor level, not the boot's neutral.
static float fusedAngle = 0.0f;
static bool firstSample = true;
static TiltCalibration tiltCalibration;

static StompState stomp;

static unsigned long lastSampleMs = 0;
static unsigned long lastLogMs = 0;

bool imuBegin() {
  pinMode(IMU_ENABLE_PIN, OUTPUT);
  digitalWrite(IMU_ENABLE_PIN, HIGH);
  delay(10);

  ready = (sensor.begin() == 0);
  if (ready) {
    // Block data update keeps each reading's two bytes from the same sample. Without
    // it, a value crossing zero while being read comes back off by exactly 256 counts,
    // which is 0.31 rad/s of phantom rotation and enough to fail a neutral capture.
    uint8_t control = 0;
    sensor.readRegister(&control, LSM6DS3_ACC_GYRO_CTRL3_C);
    sensor.writeRegister(LSM6DS3_ACC_GYRO_CTRL3_C, control | LSM6DS3_ACC_GYRO_BDU_BLOCK_UPDATE);

    Serial.print(F("[firewalker] lsm6ds3 ready @0x"));
    Serial.println(IMU_I2C_ADDR, HEX);
  } else {
    Serial.print(F("[firewalker] lsm6ds3 NOT found @0x"));
    Serial.println(IMU_I2C_ADDR, HEX);
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

  latest.ax = sensor.readFloatAccelX() * G_TO_MPS2;
  latest.ay = sensor.readFloatAccelY() * G_TO_MPS2;
  latest.az = sensor.readFloatAccelZ() * G_TO_MPS2;
  latest.gx = sensor.readFloatGyroX() * DEGREES_TO_RADIANS;
  latest.gy = sensor.readFloatGyroY() * DEGREES_TO_RADIANS;
  latest.gz = sensor.readFloatGyroZ() * DEGREES_TO_RADIANS;
  latest.mag = sqrtf(latest.ax * latest.ax + latest.ay * latest.ay +
                     latest.az * latest.az);

  // The accelerometer gives the absolute angle and the gyro tracks fast motion
  // without drift. The first sample seeds the filter so tilt is right at boot.
  float aFwd = Mg24Mount::foreAftAcceleration(latest.ax, latest.ay, latest.az);
  float aUp = Mg24Mount::verticalAcceleration(latest.ax, latest.ay, latest.az);
  float accAngle = accelTiltAngle(aFwd, aUp);
  float gyroRate = Mg24Mount::pitchAngularRate(latest.gx, latest.gy, latest.gz);
  if (firstSample) {
    fusedAngle = accAngle;
    firstSample = false;
  } else {
    fusedAngle = fuseTiltStep(fusedAngle, accAngle, gyroRate, dt, IMU_FILTER_ALPHA);
  }

  stompStep(stomp, latest.mag, now,
            {IMU_STOMP_ACCEL_THRESHOLD, IMU_RELEASE_ACCEL_THRESHOLD,
             IMU_REFRACTORY_MS});

  return true;
}

const ImuSample& imuLatest() { return latest; }

float imuTiltFwd() {
  if (!ready) return 0.0f;
  return tiltFromAngle(imuRawAngleDeg(), tiltCalibration, TILT_LIMITS);
}

float imuRawAngleDeg() { return fusedAngle * 57.2957795f; }

float imuGyroMagnitude() {
  return sqrtf(latest.gx * latest.gx + latest.gy * latest.gy + latest.gz * latest.gz);
}

void imuSetCalibration(const TiltCalibration& calibration) { tiltCalibration = calibration; }

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
  Serial.print(F(") angle="));
  Serial.print(imuRawAngleDeg(), 2);
  Serial.print(F(" tilt="));
  Serial.print(imuTiltFwd(), 2);
  Serial.print(F(" armed="));
  Serial.println(stomp.armed ? F("true") : F("false"));
}

}  // namespace Firewalker
#endif
