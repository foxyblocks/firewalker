#pragma once

#include "config.h"
#include "patterns/pattern.h"

// flow — the strip shares one hue that slowly rotates through the spectrum, and
// acts as a tilt "fill gauge": at level every pixel is lit at baseline; as the
// foot tilts, pixels extinguish one-by-one from the up-end so the lit band
// shrinks toward the down-most end while the survivors brighten, leaving a
// single pixel at full tilt. A tilted stomp launches directional trails; a flat
// stomp flashes the strip white and fades back to the flow color.
// The strip is a closed ring around the foot (pixel 0 under the controller, toe and heel at
// configured indices — see firewalker_strip_map.h). A stomp launches trail fronts
// from the tilt-derived "down" point: up to 4 bands (2 per arc) diverging to
// the heel and toe, each a white head → current hue → previous hue. Driven by
// the IMU's fused fore-aft tilt. See CONTEXT.md (Flow) and ADR-0002/0003.

namespace Firewalker {

class FlowPattern : public Pattern {
 public:
  const __FlashStringHelper* name() const override;
  void enter() override;
  void update(const PatternInput& in) override;

 private:
  // A travelling trail front: a band head that advances `dir` along one arc of
  // the ring, bounded to [lo, hi]. Coordinates are *unwrapped* — on the wrap
  // arc hi runs past the last pixel index and positions fold back to real
  // pixels (stripWrapIndex) only when painting.
  struct Front {
    float    head;
    int8_t   dir;
    uint16_t lo, hi;
    bool     active;
    float    bright;  // 0..1 band brightness, set from the stomp force at spawn
  };

  float pos_[LED_COUNT];          // fore-aft foot position per pixel (toe=1, heel=0)
  Front fronts_[FLOW_MAX_FRONTS];
  float hue_ = 0.0f;              // current hue on the 0..65535 wheel (float to accumulate)
  float flashRemainMs_ = 0.0f;    // countdown of a flat-stomp white flash (ms left)
  bool  built_ = false;

  void buildPositions();
  // Launch fronts from the current down-point; strength (0..1, the stomp force)
  // sets the band brightness.
  void spawnTrail(float tilt, float strength);
};

}  // namespace Firewalker
