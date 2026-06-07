#include "modes/fsr_debug.h"

#include <Arduino.h>

#include "firewalker_core.h"

namespace FsrDebugMode {

void setup() {
  Firewalker::setupCore(F("fsr_debug"));
}

void loop() {
  bool fsrSampled = Firewalker::sampleFsr();

  if (Firewalker::debugButtonPressed()) {
    Firewalker::spawnTrail();
    Firewalker::renderTrails();
  }

  Firewalker::advanceTrailsIfDue();

  if (!Firewalker::hasActiveTrails() && fsrSampled) {
    Firewalker::renderFsrIdle();
  }
}

}  // namespace FsrDebugMode
