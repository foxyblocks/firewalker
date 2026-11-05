#pragma once

#include "config.h"
#include "firewalker_recipe_engine.h"
#include "patterns/pattern.h"

// RecipePattern shows any compiled recipe, built in or uploaded, using the recipe engine. It connects
// that engine, which knows nothing about hardware, to the strip. There's one of these on a boot, and
// load() swaps which recipe it's showing. See firewalker_recipe_engine.h and ADR-0005.

namespace Firewalker {

class RecipePattern : public Pattern {
 public:
  // Decodes a compiled recipe and makes it the one this pattern shows. On anything but Ok, it keeps
  // showing what it was. The bytes needn't stay around afterward.
  RecipeDecodeResult load(const uint8_t* bytes, size_t size);

  const char* recipeName() const { return recipe_.name; }

  const __FlashStringHelper* name() const override;
  void enter() override;
  void update(const PatternInput& in) override;

 private:
  Recipe recipe_;
  Recipe incoming_;  // decoded here first, so a refused recipe can't disturb the one on the strip
  RecipeEngine<STRIP_MAX_PIXELS> engine_;
};

}  // namespace Firewalker
