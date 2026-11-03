#include "firewalker_imu.h"

#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <math.h>

#include "config.h"
#include "firewalker_fusion.h"

namespace Firewalker {

static Adafruit_MPU6050 mpu;
static bool          ready        = false;
static ImuSample     latest       = {0, 0, 0, 0, 0, 0, IMU_GRAVITY};

// Fused fore-aft tilt, radians (0 = level). The filter math is the pure
// fuseTiltStep() in firewalker_fusion.h; this module just feeds it samples.
static float         fusedAngle   = 0.0f;
static bool          firstSample  = true;

// Stomp detection state (pure stompStep() hysteresis, firewalker_fusion.h).
static StompState    stomp;

static unsigned long lastSampleMs = 0;
static unsigned long lastLogMs    = 0;

// Pick a signed accel/gyro component by axis index (0=X,1=Y,2=Z) — lets the
// mount-specific axis mapping live in config.h instead of being hard-coded here.
static float accelAxis(uint8_t idx, float sign) {
  float v = (idx == 0) ? latest.ax : (idx == 1) ? latest.ay : latest.az;
  return v * sign;
}
static float gyroAxis(uint8_t idx, float sign) {
  float v = (idx == 0) ? latest.gx : (idx == 1) ? latest.gy : latest.gz;
  return v * sign;
}

bool imuBegin() {
  Wire.begin();  // Feather RP2040 SDA/SCL (GP2/GP3, also the STEMMA QT port)
  ready = mpu.begin(IMU_I2C_ADDR);
  if (ready) {
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    Serial.print(F("[firewalker] mpu6050 ready @0x"));
    Serial.println(IMU_I2C_ADDR, HEX);
  } else {
    Serial.print(F("[firewalker] mpu6050 NOT found @0x"));
    Serial.print(IMU_I2C_ADDR, HEX);
    Serial.println(F(" — check SDA/SCL, 3V3, GND, AD0"));
  }

  Serial.print(F("[firewalker] imu stomp |a|>="));
  Serial.print(IMU_STOMP_ACCEL_THRESHOLD);
  Serial.print(F(" release<="));
  Serial.print(IMU_RELEASE_ACCEL_THRESHOLD);
  Serial.print(F(" tilt axis(accel fwd="));
  Serial.print(IMU_MOUNT_FOREAFT_AXIS);
  Serial.print(F(" up="));
  Serial.print(IMU_MOUNT_VERTICAL_AXIS);
  Serial.print(F(" gyro="));
  Serial.print(IMU_MOUNT_PITCH_GYRO_AXIS);
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

  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  latest.ax = a.acceleration.x;
  latest.ay = a.acceleration.y;
  latest.az = a.acceleration.z;
  latest.gx = g.gyro.x;
  latest.gy = g.gyro.y;
  latest.gz = g.gyro.z;
  latest.mag = sqrtf(latest.ax * latest.ax + latest.ay * latest.ay +
                     latest.az * latest.az);

  // Complementary filter for the fore-aft tilt angle (pure math in
  // firewalker_fusion.h): the accelerometer gives the absolute angle, the
  // gyro's pitch-rate axis is integrated to track fast motion without drift.
  float aFwd = accelAxis(IMU_MOUNT_FOREAFT_AXIS, IMU_MOUNT_FOREAFT_SIGN);
  float aUp = accelAxis(IMU_MOUNT_VERTICAL_AXIS, IMU_MOUNT_VERTICAL_SIGN);
  float accAngle = accelTiltAngle(aFwd, aUp);
  float gyroRate = gyroAxis(IMU_MOUNT_PITCH_GYRO_AXIS, IMU_MOUNT_PITCH_GYRO_SIGN);
  if (firstSample) {
    fusedAngle = accAngle;
    firstSample = false;
  } else {
    fusedAngle = fuseTiltStep(fusedAngle, accAngle, gyroRate, dt, IMU_FILTER_ALPHA);
  }

  // Stomp hysteresis + refractory (pure stompStep() in firewalker_fusion.h).
  stompStep(stomp, latest.mag, now,
            {IMU_STOMP_ACCEL_THRESHOLD, IMU_RELEASE_ACCEL_THRESHOLD,
             IMU_REFRACTORY_MS});

  return true;
}

const ImuSample& imuLatest() { return latest; }

float imuTiltFwd() {
  // Trim the mount's sole-flat fore-aft cant so a flat foot reads level, then
  // normalize to ±1 at IMU_TILT_FULL_DEG of tilt from flat. DEG→RAD = π/180.
  float trimmed = fusedAngle - IMU_MOUNT_FOREAFT_REST_DEG * 0.0174532925f;
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

  Serial.print(F("[firewalker] imu a=("));
  Serial.print(latest.ax, 2); Serial.print(F(","));
  Serial.print(latest.ay, 2); Serial.print(F(","));
  Serial.print(latest.az, 2); Serial.print(F(") |a|="));
  Serial.print(latest.mag, 2);
  Serial.print(F(" g=("));
  Serial.print(latest.gx, 2); Serial.print(F(","));
  Serial.print(latest.gy, 2); Serial.print(F(","));
  Serial.print(latest.gz, 2); Serial.print(F(") tilt="));
  Serial.print(imuTiltFwd(), 2);
  Serial.print(F(" armed="));
  Serial.println(stomp.armed ? F("true") : F("false"));
}

}  // namespace Firewalker
