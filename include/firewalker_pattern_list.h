#pragma once

// What a boot can show, and what a name means. Every pattern is a recipe:
//
// - Uploaded: a recipe in this boot's flash, in a slot. See firewalker_recipe_store.h.
// - Built-in: a recipe compiled into the firmware, from the list in patterns/built-ins.txt.
//
// An upload hides a built-in of the same name, so a tweaked `comet` can be sent to a boot to try it,
// and deleting the upload brings the built-in back. Only `off` is reserved: it stops the strip.
//
// Pure and Arduino-free, so test/test_pattern_list can run it off-hardware. final_app owns the actual
// patterns and turns what's found here into one on the strip.

#include <stdint.h>
#include <string.h>

#include "firewalker_settings.h"

namespace Firewalker {

// The most names a `patterns` reply can hold, which sets REMOTE_LINE_MAX: 16 built-in and
// 16 uploaded. designer/src/recipe/generateBuiltins.ts enforces the built-in limit.
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

enum class PatternSource : uint8_t { Unknown, Off, Uploaded, BuiltIn };

struct PatternLookup {
  PatternSource source;
  uint8_t index;  // into the uploads or the built-ins, by source
};

// Says what a name means on this boot: off, then uploads, then built-ins.
inline PatternLookup findPattern(const PatternCatalog& catalog, const char* name) {
  if (strcmp(name, PATTERN_OFF) == 0) return {PatternSource::Off, 0};
  for (uint8_t i = 0; i < catalog.uploadSlots; i++) {
    const UploadedRecipe& upload = catalog.uploads[i];
    if (upload.used && upload.readable && strcmp(name, upload.name) == 0) return {PatternSource::Uploaded, i};
  }
  for (uint8_t i = 0; i < catalog.builtInCount; i++) {
    if (strcmp(name, catalog.builtIns[i].name) == 0) return {PatternSource::BuiltIn, i};
  }
  return {PatternSource::Unknown, 0};
}

// Repairs saved selections against this boot's current catalog. Missing `flow` and
// `fire-trail` selections resume as their recipe counterparts; any other missing recipe
// uses the default. Check the catalog first so a newly uploaded recipe named `flow` keeps
// its own identity. Only the two names change, including the remembered pattern while off.
// Returns whether the caller needs to save settings again.
inline bool restoreSavedPatterns(const PatternCatalog& catalog, Settings& settings) {
  auto restore = [&](char* name) {
    if (findPattern(catalog, name).source != PatternSource::Unknown) return false;
    const char* replacement = strcmp(name, "fire-trail") == 0 ? "fire-stomp" : PATTERN_DEFAULT;
    if (findPattern(catalog, replacement).source == PatternSource::Unknown) replacement = PATTERN_DEFAULT;
    if (strcmp(name, replacement) == 0) return false;
    copyPatternName(name, replacement);
    return true;
  };
  const bool patternChanged = restore(settings.pattern);
  const bool lastLitChanged = restore(settings.lastLitPattern);
  return patternChanged || lastLitChanged;
}

// Writes the names a client can select, for the `patterns` reply: built-ins and uploads together in
// alphabetical order, each name once. Off isn't one, because it's the absence of a
// pattern. Returns how many names it wrote. The names point into the catalog, so they're good until an
// upload changes.
inline uint8_t listPatterns(const PatternCatalog& catalog, const char** out, uint8_t max) {
  uint8_t count = 0;
  // Sorted as it goes, by sliding each new name into place among the recipes so far.
  auto insert = [&](const char* name) {
    if (count >= max) return;
    uint8_t at = 0;
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
