#pragma once

#include <Arduino.h>

namespace Firewalker {

void setupCore(const __FlashStringHelper* modeName);

bool sampleFsr();
bool fsrPressed();
bool debugButtonPressed();

void spawnTrail();
void renderTrails();
void advanceTrailsIfDue();
void renderIdleBrightness(uint8_t brightness);
void renderFsrIdle();
bool hasActiveTrails();

}  // namespace Firewalker
