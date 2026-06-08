// imu_debug — bench / calibration build for the GY-521 (MPU-6050). It logs raw
// accel + gyro, the fused fore-aft tilt, and stomp events over serial, and
// mirrors the live tilt as strip brightness so you can confirm the axis mapping
// by eye. Use it to set the FLOW_* axis indices/signs and the stomp thresholds
// in config.h before running the app. See docs/wiring-mpu6050.md.

#include "modes/imu_debug.h"

#include <Arduino.h>
#include <math.h>

#include "config.h"
#include "firewalker_core.h"
#include "firewalker_imu.h"

namespace ImuDebugMode {

// Map the fused tilt magnitude to a 0..LED_BRIGHTNESS idle level (floor so a
// level board still glows). Tilting the shoe should ramp the strip up — a quick
// visual check that the tilt axis is mapped sensibly.
static uint8_t tiltBrightness(float tilt) {
  float t = fabsf(tilt);
  if (t > 1.0f) t = 1.0f;
  return (uint8_t)(IDLE_MIN_BRIGHTNESS + t * (LED_BRIGHTNESS - IDLE_MIN_BRIGHTNESS));
}

void setup() {
  Firewalker::setupCore(F("imu_debug"));
  Firewalker::imuBegin();  // prints the mpu / threshold / axis banner
}

void loop() {
  bool sampled = Firewalker::imuUpdate();
  if (sampled) Firewalker::imuLog();

  if (Firewalker::imuTakeStomp()) {
    Serial.println(F("[firewalker] imu stomp"));
    Firewalker::renderIdleBrightness(LED_BRIGHTNESS);  // brief full-strip flash
    return;
  }

  if (sampled) {
    Firewalker::renderIdleBrightness(tiltBrightness(Firewalker::imuTiltFwd()));
  }

  // D6 here just logs a marker — handy while probing on the bench.
  if (Firewalker::debugButtonPressed()) {
    Serial.println(F("[firewalker] button press"));
  }
}

}  // namespace ImuDebugMode
