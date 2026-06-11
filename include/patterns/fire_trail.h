#pragma once

#include "config.h"
#include "patterns/pattern.h"

// fire-trail — each stomp spawns a fire-gradient trail (a band of FIRE_TRAIL_LEN
// pixels) that climbs the strip bottom→top, wiping in at the bottom and out at
// the top with no hold; several stack at once (up to FIRE_TRAIL_MAX). Owns the whole
// trail engine — state, stepping, and rendering. Ignores tilt. See CONTEXT.md
// (Fire-trail, Trail, Fire gradient).

namespace Firewalker {

class FireTrailPattern : public Pattern {
 public:
  const __FlashStringHelper* name() const override;
  void enter() override;
  void update(const PatternInput& in) override;

 private:
  // One climbing band: `head` is its leading pixel index. It keeps advancing
  // past the strip end while the tail wipes out.
  struct Trail {
    int16_t head;
    bool    active;
  };

  uint32_t      trailColor_[FIRE_TRAIL_LEN];  // fire gradient head→tail, built once
  Trail         trails_[FIRE_TRAIL_MAX] = {};
  uint8_t       activeCount_ = 0;
  unsigned long lastStepMs_  = 0;
  bool          built_       = false;

  void buildGradient();
  void spawn();         // start a trail at the bottom (ignored if all slots busy)
  void render();        // redraw all active bands onto the strip
  void advanceIfDue();  // step heads at one pixel per FIRE_TRAIL_STEP_MS, retire done
};

}  // namespace Firewalker
