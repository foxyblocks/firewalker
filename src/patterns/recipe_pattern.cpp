// The rest of the firmware builds for size. The engine is compiled here, and it needs the speed.
#pragma GCC optimize("O2")

#include "patterns/recipe_pattern.h"

#include "firewalker_core.h"

namespace Firewalker {

RecipeDecodeResult RecipePattern::load(const uint8_t* bytes, size_t size) {
  const RecipeDecodeResult result = decodeRecipe(bytes, size, incoming_);
  if (result == RecipeDecodeResult::Ok) recipe_ = incoming_;
  return result;
}

const __FlashStringHelper* RecipePattern::name() const {
  return reinterpret_cast<const __FlashStringHelper*>(recipe_.name);
}

// Starts the recipe over, and picks up the current strip layout.
void RecipePattern::enter() { engine_.start(&recipe_, stripLayout()); }

void RecipePattern::update(const PatternInput& in) {
  engine_.update(in.tiltFwd, in.stomp, in.stompStrength, in.dt, in.audioLevel);
  const uint16_t count = engine_.pixelCount();
  for (uint16_t i = 0; i < count; i++) {
    strip.setPixelColor(i, engine_.frameByte(i, 0), engine_.frameByte(i, 1), engine_.frameByte(i, 2));
  }
  strip.show();
}

}  // namespace Firewalker
