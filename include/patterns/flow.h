#pragma once

#include "config.h"
#include "patterns/pattern.h"

// flow — the strip shares one hue that slowly rotates through the spectrum, and
// "pools": brightness ramps toward whichever end tilts down (the strip is a
// loop, toe mid-strip, heel at both ends). A stomp launches trail fronts from
// the tilt-derived "down" point: up to 4 bands (2 per side) diverging to the
// heel and toe ends, each a white head → current hue → previous hue. Driven by
// the IMU's fused fore-aft tilt. See CONTEXT.md (Flow) and ADR-0002/0003.

namespace Firewalker {

class FlowPattern : public Pattern {
 public:
  const __FlashStringHelper* name() const override;
  void enter() override;
  void update(const PatternInput& in) override;

 private:
  // A travelling trail front: a band head that advances `dir` along the strip,
  // bounded to one side of the loop [lo, hi].
  struct Front {
    float    head;
    int8_t   dir;
    uint16_t lo, hi;
    bool     active;
  };

  float pos_[LED_COUNT];          // fore-aft foot position per pixel (toe=1, heel ends=0)
  Front fronts_[FLOW_MAX_FRONTS];
  float hue_ = 0.0f;              // current hue on the 0..65535 wheel (float to accumulate)
  bool  built_ = false;

  void buildPositions();
  void spawnTrail(float tilt);    // launch fronts from the current down-point
};

}  // namespace Firewalker
