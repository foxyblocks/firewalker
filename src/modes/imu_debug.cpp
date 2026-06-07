// imu_debug — bring-up / test mode for the GY-521 (MPU-6050) accelerometer +
// gyroscope, the candidate replacement for the FSR stomp sensor.
//
// What it does:
//   * Polls the MPU-6050 over I2C (~50 Hz) and logs accel + gyro over serial so
//     you can watch raw movement and tune thresholds (see docs/wiring-mpu6050.md).
//   * Detects a "stomp" from the total acceleration magnitude (a spike well
//     above the ~9.81 m/s^2 gravity baseline), with the same arm/release
//     hysteresis + refractory gap the FSR uses, and spawns a fire trail — so
//     this mode doubles as a test that the IMU can drive the real animation.
//   * When no trail is running, maps movement intensity to the idle yellow
//     brightness, giving an at-a-glance "how hard is it being shaken" readout.
//
// The D6 debug button still spawns a trail here, so the animation can be
// exercised even before the IMU thresholds are dialled in. All MPU-6050 code is
// confined to this mode and the file body is compiled only into the imu_debug
// build environment (the Adafruit MPU6050 library isn't linked into the others,
// and PlatformIO otherwise compiles every src/ file in every env).

#if defined(FIREWALKER_MODE_IMU_DEBUG)

#include "modes/imu_debug.h"

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <math.h>

#include "config.h"
#include "firewalker_core.h"

namespace ImuDebugMode {

static Adafruit_MPU6050 mpu;
static bool          mpuReady     = false;
static bool          armed        = true;   // hysteresis: ready to fire a stomp
static unsigned long lastSampleMs = 0;
static unsigned long lastLogMs    = 0;
static unsigned long lastStompMs  = 0;
static float         latestMag    = IMU_GRAVITY;  // most recent |accel| (m/s^2)

// Map movement intensity (|accel| - gravity) to a 0..LED_BRIGHTNESS idle level,
// reusing the FSR idle brightness floor so a still IMU still glows faintly.
static uint8_t idleBrightness(float magnitude) {
  float delta = fabsf(magnitude - IMU_GRAVITY);
  if (delta <= IMU_ACCEL_DELTA_MIN) return FSR_IDLE_MIN_BRIGHTNESS;
  if (delta >= IMU_ACCEL_DELTA_MAX) return LED_BRIGHTNESS;

  float span = IMU_ACCEL_DELTA_MAX - IMU_ACCEL_DELTA_MIN;
  float frac = (delta - IMU_ACCEL_DELTA_MIN) / span;
  return (uint8_t)(FSR_IDLE_MIN_BRIGHTNESS +
                   frac * (LED_BRIGHTNESS - FSR_IDLE_MIN_BRIGHTNESS));
}

void setup() {
  Firewalker::setupCore(F("imu_debug"));

  Wire.begin();  // Feather RP2040 SDA/SCL (GP2/GP3, also the STEMMA QT port)
  mpuReady = mpu.begin(IMU_I2C_ADDR);
  if (mpuReady) {
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
  Serial.print(F(" refractory="));
  Serial.print(IMU_REFRACTORY_MS);
  Serial.println(F("ms"));
}

void loop() {
  unsigned long now = millis();

  bool sampled = false;
  if (mpuReady && (now - lastSampleMs) >= IMU_SAMPLE_MS) {
    lastSampleMs = now;
    sampled = true;

    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);

    float ax = a.acceleration.x;
    float ay = a.acceleration.y;
    float az = a.acceleration.z;
    latestMag = sqrtf(ax * ax + ay * ay + az * az);

    // Throttled debug line: raw accel (m/s^2), gyro (rad/s), magnitude, arm state.
    if ((now - lastLogMs) >= IMU_LOG_MS) {
      lastLogMs = now;
      Serial.print(F("[firewalker] imu a=("));
      Serial.print(ax, 2); Serial.print(F(","));
      Serial.print(ay, 2); Serial.print(F(","));
      Serial.print(az, 2); Serial.print(F(") |a|="));
      Serial.print(latestMag, 2);
      Serial.print(F(" g=("));
      Serial.print(g.gyro.x, 2); Serial.print(F(","));
      Serial.print(g.gyro.y, 2); Serial.print(F(","));
      Serial.print(g.gyro.z, 2); Serial.print(F(") armed="));
      Serial.println(armed ? F("true") : F("false"));
    }

    // Stomp detect: fire once when |accel| spikes past the threshold (and the
    // refractory window has elapsed), then wait for it to fall back below the
    // release threshold before arming again.
    if (armed && latestMag >= IMU_STOMP_ACCEL_THRESHOLD &&
        (now - lastStompMs) >= IMU_REFRACTORY_MS) {
      armed = false;
      lastStompMs = now;
      Serial.print(F("[firewalker] imu stomp @"));
      Serial.println(latestMag, 2);
      Firewalker::spawnTrail();
      Firewalker::renderTrails();
    } else if (!armed && latestMag <= IMU_RELEASE_ACCEL_THRESHOLD) {
      armed = true;
    }
  }

  // Deterministic bench trigger, available even when the IMU is absent.
  if (Firewalker::debugButtonPressed()) {
    Firewalker::spawnTrail();
    Firewalker::renderTrails();
  }

  Firewalker::advanceTrailsIfDue();

  // Idle visual: show live movement intensity as strip brightness.
  if (!Firewalker::hasActiveTrails() && sampled) {
    Firewalker::renderIdleBrightness(idleBrightness(latestMag));
  }
}

}  // namespace ImuDebugMode

#endif  // FIREWALKER_MODE_IMU_DEBUG
