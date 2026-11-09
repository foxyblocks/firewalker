#pragma once

#include <Arduino.h>

// A Pattern renders a runtime-selectable recipe onto the strip. RecipePattern connects
// the pure recipe engine to the hardware, and the app loads a built-in or uploaded recipe
// when the remote selects its name. Each frame the app feeds it the fused orientation, whether a
// stomp fired this tick, the live sound level, and elapsed time, and the pattern renders to the
// shared strip. Brightness belongs to the caller, so patterns never set it. See
// ADR-0002.

namespace Firewalker {

struct PatternInput {
  float         tiltFwd;       // fused fore-aft tilt, ~[-1,+1], + = toe-down
  bool          stomp;         // true on the tick a stomp fires
  float         stompStrength; // 0..1 force of that stomp (valid when stomp is true)
  unsigned long dt;            // ms since the previous update
  float         audioLevel = 0.0f; // normalized 0..1 sound level; from the onboard microphone service
};

class Pattern {
 public:
  virtual ~Pattern() {}

  virtual const __FlashStringHelper* name() const = 0;

  // Starts the pattern from the beginning, even when it is already active.
  // Resets animation state and picks up the current strip layout.
  virtual void enter() {}

  // Advance one frame and render to the strip.
  virtual void update(const PatternInput& in) = 0;
};

}  // namespace Firewalker
