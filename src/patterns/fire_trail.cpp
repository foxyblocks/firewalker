#include "patterns/fire_trail.h"

#include "firewalker_core.h"

namespace Firewalker {

const __FlashStringHelper* FireTrailPattern::name() const { return F("fire-trail"); }

void FireTrailPattern::enter() { resetTrails(); }

void FireTrailPattern::update(const PatternInput& in) {
  if (in.stomp) {
    spawnTrail();
    renderTrails();
  }
  advanceTrailsIfDue();
}

}  // namespace Firewalker
