// Logs raw motion, learned boot tilt, and stomps over USB. This build loads the
// same saved 3D mounting reference as the app, so its strip preview works with a
// controller mounted at any angle. Capture neutral and a side in final_app first.

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
  Firewalker::imuBegin();
  Firewalker::imuLoadSavedCalibration();
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
