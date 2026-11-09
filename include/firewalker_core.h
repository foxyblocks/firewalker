#pragma once

#include <Arduino.h>

#include "firewalker_strip.h"
#include "firewalker_strip_map.h"

// Shared hardware services: the main strip, the onboard status LED, and temporary
// visuals such as identify and idle fill. The final_app mode owns identify's timing;
// renderIdentifyBlink drives both lights from that one phase. Sensor logic lives in
// firewalker_imu; visual behaviors and their animation engines live in patterns/.

namespace Firewalker {

// The main shoe strip. Patterns draw to it directly.
extern LedStrip strip;

// The ring layout in use: the build's default until a mode applies a saved one. Patterns
// read it when they enter, so call a pattern's enter() again after changing it.
const StripLayout& stripLayout();

// Puts a layout into use, including the strip's pixel count. Expects a valid layout.
void setStripLayout(const StripLayout& layout);

// Starts USB serial, lights the status LED, starts the strip with every pixel
// blanked at the default brightness, and logs a one-line banner. Call first.
void setupCore(const __FlashStringHelper* modeName);

// Fill the whole strip a solid color scaled to a 0..LED_BRIGHTNESS level (the
// imu_debug motion visual).
void renderIdleBrightness(uint8_t brightness);

// Show one identify frame on both the MG24 Sense's user LED and the entire strip.
// Uses the strip's current brightness and changes no settings. While identify owns
// the lights, the caller must skip updateStatusLight so it cannot overwrite this phase.
void renderIdentifyBlink(bool lit);

// What the onboard LED shows, so a shoe's state is visible with no phone or
// serial monitor attached.
enum class StatusLight : uint8_t {
  Running,        // solid
  SensorMissing,  // slow blink: patterns run, but motion input is unavailable
  Calibrating,    // fast blink: a capture is collecting
};

// Advances the blink pattern. Call often from the main loop.
void updateStatusLight(StatusLight state);

}  // namespace Firewalker
