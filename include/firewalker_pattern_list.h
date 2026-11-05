#pragma once

// What a boot can show, and what a name means. A pattern is one of three kinds:
//
// - Native: written in C++. See NATIVE_PATTERNS.
// - Uploaded: a recipe in this boot's flash, in a slot. See firewalker_recipe_store.h.
// - Built-in: a recipe compiled into the firmware, from the list in patterns/built-ins.txt.
//
// An upload hides a built-in of the same name, so a tweaked `comet` can be sent to a boot to try it,
// and deleting the upload brings the built-in back. A native pattern's name can't be used by a recipe
// at all.
//
// Pure and Arduino-free, so test/test_pattern_list can run it off-hardware. final_app owns the actual
// patterns and turns what's found here into one on the strip.

#include <stdint.h>
#include <string.h>

#include "firewalker_settings.h"

namespace Firewalker {

constexpr const char* const NATIVE_PATTERNS[] = {"flow", "fire-trail"};
constexpr uint8_t NATIVE_PATTERN_COUNT = sizeof(NATIVE_PATTERNS) / sizeof(NATIVE_PATTERNS[0]);

// The most names a `patterns` reply can hold, which sets REMOTE_LINE_MAX: 2 native, 14 built-in,
// and 16 uploaded.
constexpr uint8_t PATTERN_LIST_MAX = 32;

struct BuiltInRecipe {
  const char* name;
  const uint8_t* bytes;
  uint16_t size;
};

// One upload slot, as the firmware keeps it in RAM so it needn't read flash to answer a question.
struct UploadedRecipe {
  bool used;
  bool readable;  // in a version this firmware can run
  char name[PATTERN_NAME_SIZE];
  uint16_t size;
  uint32_t crc;
};

struct PatternCatalog {
  const BuiltInRecipe* builtIns;
  uint8_t builtInCount;
  const UploadedRecipe* uploads;
  uint8_t uploadSlots;
};

enum class PatternSource : uint8_t { Unknown, Off, Native, Uploaded, BuiltIn };

struct PatternLookup {
  PatternSource source;
  uint8_t index;  // into NATIVE_PATTERNS, the uploads, or the built-ins, by source
};

// Says what a name means on this boot: off and native patterns first, then uploads, then built-ins.
inline PatternLookup findPattern(const PatternCatalog& catalog, const char* name) {
  if (strcmp(name, PATTERN_OFF) == 0) return {PatternSource::Off, 0};
  for (uint8_t i = 0; i < NATIVE_PATTERN_COUNT; i++) {
    if (strcmp(name, NATIVE_PATTERNS[i]) == 0) return {PatternSource::Native, i};
  }
  for (uint8_t i = 0; i < catalog.uploadSlots; i++) {
    const UploadedRecipe& upload = catalog.uploads[i];
    if (upload.used && upload.readable && strcmp(name, upload.name) == 0) return {PatternSource::Uploaded, i};
  }
  for (uint8_t i = 0; i < catalog.builtInCount; i++) {
    if (strcmp(name, catalog.builtIns[i].name) == 0) return {PatternSource::BuiltIn, i};
  }
  return {PatternSource::Unknown, 0};
}

// Writes the names a client can select, for the `patterns` reply: native patterns, then built-ins and
// uploads together in alphabetical order, each name once. Off isn't one, because it's the absence of a
// pattern. Returns how many names it wrote. The names point into the catalog, so they're good until an
// upload changes.
inline uint8_t listPatterns(const PatternCatalog& catalog, const char** out, uint8_t max) {
  uint8_t count = 0;
  for (uint8_t i = 0; i < NATIVE_PATTERN_COUNT && count < max; i++) out[count++] = NATIVE_PATTERNS[i];

  // Sorted as it goes, by sliding each new name into place among the recipes so far.
  const uint8_t firstRecipe = count;
  auto insert = [&](const char* name) {
    if (count >= max) return;
    uint8_t at = firstRecipe;
    while (at < count && strcmp(out[at], name) < 0) at++;
    if (at < count && strcmp(out[at], name) == 0) return;
    for (uint8_t i = count; i > at; i--) out[i] = out[i - 1];
    out[at] = name;
    count++;
  };
  for (uint8_t i = 0; i < catalog.builtInCount; i++) insert(catalog.builtIns[i].name);
  for (uint8_t i = 0; i < catalog.uploadSlots; i++) {
    if (catalog.uploads[i].used && catalog.uploads[i].readable) insert(catalog.uploads[i].name);
  }
  return count;
}

}  // namespace Firewalker
