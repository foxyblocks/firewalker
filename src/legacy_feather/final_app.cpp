// final_app — the shoe app. The IMU drives everything: a stomp (acceleration
// spike) and the fused fore-aft tilt feed whichever Pattern is active. D6 cycles
// patterns; the firmware boots into flow. See ADR-0002.

#include "modes/final_app.h"

#include <Arduino.h>

#include "config.h"
#include "firewalker_core.h"
#include "firewalker_imu.h"
#include "patterns/pattern.h"
#include "patterns/flow.h"
#include "patterns/fire_trail.h"

namespace FinalAppMode {

static Firewalker::FlowPattern      flow;
static Firewalker::FireTrailPattern fireTrail;

// Boot into flow (index 0); D6 cycles through this list.
static Firewalker::Pattern* patterns[] = {&flow, &fireTrail};
static const uint8_t PATTERN_COUNT = sizeof(patterns) / sizeof(patterns[0]);
static uint8_t       active = 0;
static unsigned long lastUpdateMs = 0;

static void announce() {
  Serial.print(F("[firewalker] pattern -> "));
  Serial.println(patterns[active]->name());
}

void setup() {
  Firewalker::setupCore(F("final_app"));
  Firewalker::imuBegin();
  lastUpdateMs = millis();
  patterns[active]->enter();
  announce();
}

void loop() {
  Firewalker::imuUpdate();  // poll IMU, update fused tilt + stomp state

  if (Firewalker::debugButtonPressed()) {  // D6 cycles patterns
    active = (active + 1) % PATTERN_COUNT;
    patterns[active]->enter();
    announce();
  }

  unsigned long now = millis();
  Firewalker::PatternInput in;
  in.tiltFwd       = Firewalker::imuTiltFwd();
  in.stomp         = Firewalker::imuTakeStomp();
  in.stompStrength = Firewalker::imuStompStrength();
  in.dt            = now - lastUpdateMs;
  lastUpdateMs = now;

  patterns[active]->update(in);
}

}  // namespace FinalAppMode
