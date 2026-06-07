#include "modes/final_app.h"

#include <Arduino.h>

#include "firewalker_core.h"

namespace FinalAppMode {

void setup() {
  Firewalker::setupCore(F("final_app"));
}

void loop() {
  bool fsrSampled = Firewalker::sampleFsr();

  if ((fsrSampled && Firewalker::fsrPressed()) || Firewalker::debugButtonPressed()) {
    Firewalker::spawnTrail();
    Firewalker::renderTrails();
  }

  Firewalker::advanceTrailsIfDue();
}

}  // namespace FinalAppMode
