#pragma once

// A compiled recipe: the structs the engine reads, and the decoder that fills them in from bytes.
// This is the firmware's end of the designer's compile.ts, and both read the layout in
// specs/recipe-engine-spec.md. The field order and ranges come from generated/recipe_tables.h, so
// there's no second copy of them here.
//
// Pure and Arduino-free, so test/test_recipe_decode can run it off-hardware.
//
// The decoder trusts nothing, because uploads come from anyone in Bluetooth range. It checks the
// checksum, version, name, and every length and option, and it limits every number to its field's
// range. A recipe it refuses simply doesn't run. It can't read past the end of its input, and the
// structs it fills in always hold values the engine can safely use.

#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "firewalker_settings.h"
#include "generated/recipe_tables.h"

namespace Firewalker {

// A number that's either fixed or follows a source. When it's fixed, `min` holds the value.
struct RecipeKnob {
  bool bound;
  RecipeSource source;
  float min;
  float max;
  uint16_t ms;  // the period of a wave, or the fade of a stomp fade
};

// One layer. Its values sit in arrays by kind, at the places named in RecipeSlot, so the same
// decoder handles every layer type. A layer's blend and opacity are at slot 0.
struct RecipeLayer {
  RecipeLayerType type;
  uint8_t choices[RECIPE_MAX_CHOICES];
  float numbers[RECIPE_MAX_NUMBERS];
  RecipeKnob knobs[RECIPE_MAX_KNOBS];
  uint8_t paletteCount;
  float palette[RECIPE_MAX_PALETTE_STOPS][3];  // R, G, B from 0 to 1
};

struct Recipe {
  char name[RECIPE_MAX_NAME_LENGTH + 1];
  uint8_t layerCount;
  RecipeLayer layers[RECIPE_MAX_LAYERS];
};

enum class RecipeDecodeResult : uint8_t {
  Ok,
  BadSize,      // too short to hold a recipe, or longer than one can be
  BadChecksum,  // damaged on the way or in flash
  BadVersion,   // a version this firmware can't read
  BadRecipe,    // the checksum is right, but the contents don't make sense
};

static_assert(RECIPE_MAX_NAME_LENGTH == PATTERN_NAME_MAX_LENGTH, "A recipe's name has to fit a pattern name");

// Names that off and the firmware's own patterns keep for themselves.
inline bool recipeNameReserved(const char* name) {
  for (const char* reserved : RECIPE_RESERVED_NAMES) {
    if (strcmp(name, reserved) == 0) return true;
  }
  return false;
}

// Reads the binary, and can't read past the end. Going past it returns zeros and sets `failed`, so
// the decoder can read a whole layer before it has to check.
class RecipeReader {
 public:
  RecipeReader(const uint8_t* bytes, size_t size) : bytes_(bytes), size_(size) {}

  uint8_t u8() {
    if (at_ >= size_) {
      failed = true;
      return 0;
    }
    return bytes_[at_++];
  }

  uint16_t u16() {
    const uint8_t low = u8();
    return (uint16_t)(low | ((uint16_t)u8() << 8));
  }

  // A number stored across its field's range as an int16, read back in single precision and limited
  // to the field's range. compile.ts does the same math, so both get exactly the same value.
  float scaled(const RecipeFieldInfo& field) {
    const float range = fmaxf(fabsf(field.min), fabsf(field.max));
    const float value = (float)(int16_t)u16() / 32767.0f * range;
    return fminf(field.max, fmaxf(field.min, value));
  }

  bool atEnd() const { return at_ == size_; }

  bool failed = false;

 private:
  const uint8_t* bytes_;
  size_t size_;
  size_t at_ = 0;
};

inline uint16_t recipeClampMs(uint16_t value, uint16_t low, uint16_t high) {
  return value < low ? low : value > high ? high : value;
}

// Reads a bound knob: its source, its two ends, and for a wave or stomp fade, its time.
inline bool readRecipeBinding(RecipeReader& reader, const RecipeFieldInfo& field, RecipeKnob& knob) {
  const uint8_t source = reader.u8();
  if (source > (uint8_t)RecipeSource::Wave) return false;
  knob.bound = true;
  knob.source = (RecipeSource)source;
  knob.min = reader.scaled(field);
  knob.max = reader.scaled(field);
  knob.ms = 0;
  if (knob.source == RecipeSource::Wave) {
    knob.ms = recipeClampMs(reader.u16(), RECIPE_WAVE_PERIOD_MIN, RECIPE_WAVE_PERIOD_MAX);
  } else if (knob.source == RecipeSource::StompFade) {
    knob.ms = recipeClampMs(reader.u16(), RECIPE_STOMP_FADE_MIN, RECIPE_STOMP_FADE_MAX);
  }
  return true;
}

inline bool readRecipeLayer(RecipeReader& reader, RecipeLayer& layer) {
  const uint8_t type = reader.u8();
  if (type > (uint8_t)RecipeLayerType::Chase) return false;
  layer.type = (RecipeLayerType)type;
  const uint8_t boundMask = reader.u8();

  // Fields come in the table's order. A knob's bit in the mask follows that order too, which isn't
  // always its slot, since opacity comes last in the binary but sits at slot 0.
  const RecipeLayerInfo& info = RECIPE_LAYERS[type];
  uint8_t knobIndex = 0;
  for (uint8_t f = 0; f < info.count; f++) {
    const RecipeFieldInfo& field = info.fields[f];
    switch (field.kind) {
      case RecipeFieldKind::Choice: {
        const uint8_t option = reader.u8();
        if (option > (uint8_t)field.max) return false;
        layer.choices[field.slot] = option;
        break;
      }
      case RecipeFieldKind::Whole:
        layer.numbers[field.slot] = fminf(field.max, fmaxf(field.min, (float)reader.u16()));
        break;
      case RecipeFieldKind::Fraction:
        layer.numbers[field.slot] = reader.scaled(field);
        break;
      case RecipeFieldKind::Palette: {
        const uint8_t count = reader.u8();
        if (count == 0 || count > RECIPE_MAX_PALETTE_STOPS) return false;
        layer.paletteCount = count;
        for (uint8_t c = 0; c < count; c++) {
          for (uint8_t channel = 0; channel < 3; channel++) {
            layer.palette[c][channel] = (float)reader.u8() / 255.0f;
          }
        }
        break;
      }
      case RecipeFieldKind::Knob: {
        RecipeKnob& knob = layer.knobs[field.slot];
        if (boundMask & (1u << knobIndex)) {
          if (!readRecipeBinding(reader, field, knob)) return false;
        } else {
          knob.bound = false;
          knob.source = RecipeSource::Tilt;
          knob.min = reader.scaled(field);
          knob.max = knob.min;
          knob.ms = 0;
        }
        knobIndex++;
        break;
      }
    }
    if (reader.failed) return false;
  }
  return true;
}

// Fills in `out` from compiled bytes. `out` is only meaningful when this returns Ok. It's about
// 2.5 KB, so give it static storage rather than putting it on the stack.
inline RecipeDecodeResult decodeRecipe(const uint8_t* bytes, size_t size, Recipe& out) {
  // The smallest possible recipe has a version, a name, a layer count, and a checksum.
  constexpr size_t CHECKSUM_SIZE = 4;
  if (size < 4 + CHECKSUM_SIZE || size > RECIPE_MAX_BYTES) return RecipeDecodeResult::BadSize;

  const size_t bodySize = size - CHECKSUM_SIZE;
  const uint32_t stored = (uint32_t)bytes[bodySize] | ((uint32_t)bytes[bodySize + 1] << 8) |
                          ((uint32_t)bytes[bodySize + 2] << 16) | ((uint32_t)bytes[bodySize + 3] << 24);
  if (stored != settingsCrc(bytes, bodySize)) return RecipeDecodeResult::BadChecksum;

  RecipeReader reader(bytes, bodySize);
  if (reader.u8() != RECIPE_VERSION) return RecipeDecodeResult::BadVersion;

  const uint8_t nameLength = reader.u8();
  if (nameLength == 0 || nameLength > RECIPE_MAX_NAME_LENGTH) return RecipeDecodeResult::BadRecipe;
  for (uint8_t i = 0; i < nameLength; i++) out.name[i] = (char)reader.u8();
  out.name[nameLength] = '\0';
  if (!patternNameValid(out.name) || recipeNameReserved(out.name)) return RecipeDecodeResult::BadRecipe;

  out.layerCount = reader.u8();
  if (out.layerCount == 0 || out.layerCount > RECIPE_MAX_LAYERS) return RecipeDecodeResult::BadRecipe;
  for (uint8_t l = 0; l < out.layerCount; l++) {
    if (!readRecipeLayer(reader, out.layers[l])) return RecipeDecodeResult::BadRecipe;
  }

  if (reader.failed || !reader.atEnd()) return RecipeDecodeResult::BadRecipe;
  return RecipeDecodeResult::Ok;
}

}  // namespace Firewalker
