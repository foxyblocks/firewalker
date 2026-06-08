#include "firewalker_imu.h"

#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <math.h>

#include "config.h"

namespace Firewalker {

static Adafruit_MPU6050 mpu;
static bool          ready        = false;
static ImuSample     latest       = {0, 0, 0, 0, 0, 0, IMU_GRAVITY};

// Fused fore-aft tilt, radians (0 = level). Complementary filter: gyro rate
// integrated short-term, pulled toward the accelerometer's absolute angle.
static float         fusedAngle   = 0.0f;
static bool          firstSample  = true;

// Stomp detection (acceleration-magnitude hysteresis + refractory).
static bool          armed        = true;
static bool          stompPending = false;
static unsigned long lastStompMs  = 0;

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
  Serial.print(FLOW_FOREAFT_AXIS);
  Serial.print(F(" up="));
  Serial.print(FLOW_VERTICAL_AXIS);
  Serial.print(F(" gyro="));
  Serial.print(FLOW_PITCH_GYRO_AXIS);
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

  // Complementary filter for the fore-aft tilt angle. The accelerometer gives
  // the absolute angle (gravity split between the heel↔toe axis and the
  // vertical-at-rest axis); the gyro's pitch-rate axis is integrated to track
  // fast motion without drift.
  float aFwd = accelAxis(FLOW_FOREAFT_AXIS, FLOW_FOREAFT_SIGN);
  float aUp = accelAxis(FLOW_VERTICAL_AXIS, FLOW_VERTICAL_SIGN);
  float accAngle = atan2f(aFwd, aUp);
  float gyroRate = gyroAxis(FLOW_PITCH_GYRO_AXIS, FLOW_PITCH_GYRO_SIGN);
  if (firstSample) {
    fusedAngle = accAngle;
    firstSample = false;
  } else {
    fusedAngle = FLOW_FILTER_ALPHA * (fusedAngle + gyroRate * dt) +
                 (1.0f - FLOW_FILTER_ALPHA) * accAngle;
  }

  // Stomp: fire once on a magnitude spike (after the refractory gap), then
  // re-arm only once it falls back below the release threshold.
  if (armed && latest.mag >= IMU_STOMP_ACCEL_THRESHOLD &&
      (now - lastStompMs) >= IMU_REFRACTORY_MS) {
    armed = false;
    stompPending = true;
    lastStompMs = now;
  } else if (!armed && latest.mag <= IMU_RELEASE_ACCEL_THRESHOLD) {
    armed = true;
  }

  return true;
}

const ImuSample& imuLatest() { return latest; }

float imuTiltFwd() {
  float deg = fusedAngle * 57.2957795f;  // rad -> deg
  float t = deg / FLOW_TILT_FULL_DEG;
  if (t > 1.0f) t = 1.0f;
  if (t < -1.0f) t = -1.0f;
  return t;
}

bool imuTakeStomp() {
  if (!stompPending) return false;
  stompPending = false;
  return true;
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
  Serial.println(armed ? F("true") : F("false"));
}

}  // namespace Firewalker
