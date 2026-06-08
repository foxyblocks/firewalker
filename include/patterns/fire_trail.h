#pragma once

#include "patterns/pattern.h"

// fire-trail — each stomp spawns a fire-gradient trail that climbs the strip;
// several stack at once. A thin wrapper over the shared trail engine in
// firewalker_core. Ignores tilt. See CONTEXT.md (Fire-trail).

namespace Firewalker {

class FireTrailPattern : public Pattern {
 public:
  const __FlashStringHelper* name() const override;
  void enter() override;
  void update(const PatternInput& in) override;
};

}  // namespace Firewalker
