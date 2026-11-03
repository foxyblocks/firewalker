// imu_debug is the bench calibration build for the onboard sensor. It logs raw
// accel and gyro, the fused fore-aft angle, and stomp events over USB serial, and
// mirrors the live tilt as strip brightness so the axis mapping can be confirmed by
// eye. Use it to check firewalker_mg24_mount.h and the stomp thresholds in config.h.
// It applies no saved neutral offset, so tilt here is relative to sensor level.

#include "modes/imu_debug.h"

#include <Arduino.h>
#include <math.h>

#include "config.h"
#include "firewalker_core.h"
#include "firewalker_imu.h"

namespace ImuDebugMode {

// Maps tilt magnitude to a 0..LED_BRIGHTNESS level, with a floor so a level board
// still glows. Tilting the shoe should ramp the strip up.
static uint8_t tiltBrightness(float tilt) {
  float t = fabsf(tilt);
  if (t > 1.0f) t = 1.0f;
  return (uint8_t)(IDLE_MIN_BRIGHTNESS + t * (LED_BRIGHTNESS - IDLE_MIN_BRIGHTNESS));
}

void setup() {
  Firewalker::setupCore(F("imu_debug"));
  Firewalker::imuBegin();  // prints the sensor, threshold, and axis banner
}

void loop() {
  Firewalker::updateStatusLight(Firewalker::imuReady() ? Firewalker::StatusLight::Running
                                                       : Firewalker::StatusLight::SensorMissing);

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
}

}  // namespace ImuDebugMode
