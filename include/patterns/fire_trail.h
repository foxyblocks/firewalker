#pragma once

#include "config.h"
#include "firewalker_trail_path.h"
#include "patterns/pattern.h"

// fire-trail — each stomp spawns a trail of fire-gradient bands (each FIRE_TRAIL_LEN pixels)
// from whichever part of the boot is down at that moment. Toe down runs both sides of the
// foot from the toe to the heel, heel down runs them from the heel to the toe, and flat runs
// outward from the middle of each side to both ends. Bands wipe in at their origin and out
// at the far end with no hold, and several trails stack at once (up to FIRE_TRAIL_MAX). Owns
// the trail engine's state, stepping, and rendering, while the routes come from
// firewalker_trail_path.h. See CONTEXT.md (Fire-trail, Trail, Fire gradient).

namespace Firewalker {

class FireTrailPattern : public Pattern {
 public:
  const __FlashStringHelper* name() const override;
  void enter() override;
  void update(const PatternInput& in) override;

 private:
  // One stomp's bands. `head` counts the steps every front's head has taken from its start.
  // It keeps advancing past the far end while the tail wipes out. enter() clears these when
  // the layout changes, so a route never outlives the layout it was built from.
  struct Trail {
    TrailPath path;
    int16_t   head;
    bool      active;
  };

  uint32_t      trailColor_[FIRE_TRAIL_LEN];  // fire gradient head→tail, built once
  Trail         trails_[FIRE_TRAIL_MAX] = {};
  uint8_t       activeCount_ = 0;
  float         pixelsDue_   = 0.0f;  // steps owed but not yet taken, always under one pixel between frames
  bool          built_       = false;

  void buildGradient();
  void spawn(float tiltDeg);  // start a trail from the part of the boot that's down (ignored if all slots busy)
  void render();              // redraw all active bands onto the strip
  void advanceIfDue(unsigned long dt);  // step heads at FIRE_TRAIL_SPEED_PXPS, retire done
};

}  // namespace Firewalker
