#pragma once

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>

// Shared hardware + drawing services: the main strip, the onboard status pixel,
// the D6 button, the fire-trail engine, and a solid idle fill. Sensor logic
// lives elsewhere (firewalker_imu); visual behaviors live in patterns/.

namespace Firewalker {

// The main shoe strip. Patterns draw to it directly.
extern Adafruit_NeoPixel strip;

void setupCore(const __FlashStringHelper* modeName);

// Edge-triggered, debounced read of the D6 button. True once per press. The app
// uses it to cycle patterns; imu_debug uses it as a bench input.
bool debugButtonPressed();

// Fire-trail engine (used by the fire-trail pattern).
void spawnTrail();
void renderTrails();
void advanceTrailsIfDue();
void resetTrails();
bool hasActiveTrails();

// Fill the whole strip a solid color scaled to a 0..LED_BRIGHTNESS level (the
// imu_debug motion visual).
void renderIdleBrightness(uint8_t brightness);

}  // namespace Firewalker
