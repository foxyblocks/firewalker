#pragma once
#include <stdint.h>

// Pure stomp hysteresis and timing, shared by the IMU service and native tests.
// Gravity/orientation fusion lives in firewalker_orientation.h and uses all axes.
namespace Firewalker {
// Stomp detection: acceleration-magnitude hysteresis + a refractory gap, so one
// physical impact = one trigger (see CONTEXT.md, Hysteresis). The caller owns
// the state and consumes `pending`.
struct StompState {
  bool     armed       = true;
  bool     pending     = false;  // set on fire; caller clears when consumed
  uint32_t lastStompMs = 0;
  float    fireMag     = 0.0f;   // |accel| at the trigger sample (stomp "force")
};

struct StompParams {
  float    fireAbove;     // fire when |a| rises to this, if armed
  float    rearmBelow;    // re-arm once |a| falls back to this
  uint32_t refractoryMs;  // minimum gap between fires
};

inline void stompStep(StompState& s, float mag, uint32_t nowMs,
                      const StompParams& p) {
  if (s.armed && mag >= p.fireAbove && (nowMs - s.lastStompMs) >= p.refractoryMs) {
    s.armed = false;
    s.pending = true;
    s.lastStompMs = nowMs;
    s.fireMag = mag;  // remember how hard it hit, for force-scaled visuals
  } else if (!s.armed && mag <= p.rearmBelow) {
    s.armed = true;
  }
}

}  // namespace Firewalker
