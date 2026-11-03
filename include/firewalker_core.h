#pragma once

#include <Arduino.h>

#include "firewalker_strip.h"

// Shared hardware services: the main strip, the onboard status LED, and a solid
// idle fill. Sensor logic lives in firewalker_imu; visual behaviors, including
// their animation engines, live in patterns/.

namespace Firewalker {

// The main shoe strip. Patterns draw to it directly.
extern LedStrip strip;

// Starts USB serial, lights the status LED, starts the strip with every pixel
// blanked at the default brightness, and logs a one-line banner. Call first.
void setupCore(const __FlashStringHelper* modeName);

// Fill the whole strip a solid color scaled to a 0..LED_BRIGHTNESS level (the
// imu_debug motion visual).
void renderIdleBrightness(uint8_t brightness);

#if defined(FIREWALKER_LEGACY_FEATHER)
bool debugButtonPressed();
#else
// What the onboard LED shows, so a shoe's state is visible with no phone or
// serial monitor attached.
enum class StatusLight : uint8_t {
  Running,        // solid
  SensorMissing,  // slow blink: patterns run, but motion input is unavailable
  Calibrating,    // fast blink: hold the boot still
};

// Advances the blink pattern. Call often from the main loop.
void updateStatusLight(StatusLight state);
#endif

}  // namespace Firewalker
