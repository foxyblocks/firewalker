#pragma once

#include <Arduino.h>

// A Pattern is a runtime-selectable visual behavior of the strip (flow,
// fire-trail, ...). The app holds several and the remote switches between them
// live. Each frame the app feeds the pattern the fused orientation, whether a
// stomp fired this tick, and the elapsed time, and the pattern renders to the
// shared strip. Brightness belongs to the caller, so patterns never set it. See
// ADR-0002.

namespace Firewalker {

struct PatternInput {
  float         tiltFwd;       // fused fore-aft tilt, ~[-1,+1], + = toe-down
  float         tiltDeg;       // the same angle in degrees from the neutral pose, + = toe-down
  bool          stomp;         // true on the tick a stomp fires
  float         stompStrength; // 0..1 force of that stomp (valid when stomp is true)
  unsigned long dt;            // ms since the previous update
};

class Pattern {
 public:
  virtual ~Pattern() {}

  virtual const __FlashStringHelper* name() const = 0;

  // Called when this pattern becomes active, and again when the strip's layout changes
  // while it's active. Resets per-pattern state and picks up the current layout.
  virtual void enter() {}

  // Advance one frame and render to the strip.
  virtual void update(const PatternInput& in) = 0;
};

}  // namespace Firewalker
