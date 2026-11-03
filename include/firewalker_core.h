#pragma once

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>

// Shared hardware services: the main strip, the onboard status pixel, the D6
// button, and a solid idle fill. Sensor logic lives elsewhere (firewalker_imu);
// visual behaviors — including their animation engines — live in patterns/.

namespace Firewalker {

// The main shoe strip. Patterns draw to it directly.
extern Adafruit_NeoPixel strip;

void setupCore(const __FlashStringHelper* modeName);

// Edge-triggered, debounced read of the D6 button. True once per press. The app
// uses it to cycle patterns; imu_debug uses it as a bench input.
bool debugButtonPressed();

// Fill the whole strip a solid color scaled to a 0..LED_BRIGHTNESS level (the
// imu_debug motion visual).
void renderIdleBrightness(uint8_t brightness);

}  // namespace Firewalker
