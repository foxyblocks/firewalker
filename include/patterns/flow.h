#pragma once

#include "config.h"
#include "patterns/pattern.h"

// flow — the strip glows uniform magenta and "pools": brightness ramps toward
// whichever end tilts down (the toe sits mid-strip, heel at both ends — the
// strip is a loop). A stomp briefly doubles brightness, then eases back. Driven
// by the IMU's fused fore-aft tilt. See CONTEXT.md (Flow) and ADR-0002/0003.

namespace Firewalker {

class FlowPattern : public Pattern {
 public:
  const __FlashStringHelper* name() const override;
  void enter() override;
  void update(const PatternInput& in) override;

 private:
  float pos_[LED_COUNT];   // fore-aft foot position per pixel (toe=1, heel ends=0)
  float flashEnv_ = 0.0f;  // stomp flash: 1 = full flash, decays toward 0
  bool  built_ = false;

  void buildPositions();
};

}  // namespace Firewalker
