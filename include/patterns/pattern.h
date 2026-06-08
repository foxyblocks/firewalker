#pragma once

#include <Arduino.h>

// A Pattern is a runtime-selectable visual behavior of the strip (flow,
// fire-trail, ...). The app holds several and switches between them live (D6
// cycles). Each frame the app feeds the pattern the fused orientation, whether a
// stomp fired this tick, and the elapsed time, and the pattern renders to the
// shared strip. See ADR-0002.

namespace Firewalker {

struct PatternInput {
  float         tiltFwd;  // fused fore-aft tilt, ~[-1,+1], + = toe-down
  bool          stomp;    // true on the tick a stomp fires
  unsigned long dt;       // ms since the previous update
};

class Pattern {
 public:
  virtual ~Pattern() {}

  virtual const __FlashStringHelper* name() const = 0;

  // Called when this pattern becomes active — reset per-pattern state.
  virtual void enter() {}

  // Advance one frame and render to the strip.
  virtual void update(const PatternInput& in) = 0;
};

}  // namespace Firewalker
