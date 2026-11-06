#pragma once

// Receives a recipe a piece at a time, for the `recipe begin`, `recipe data`, and `recipe end` commands.
// A recipe is too big for one command, so a client sends up to 15 bytes per line and waits for each
// reply. The offset on each line keeps them in order: a lost or repeated line gets `wrong-offset` and
// the place to carry on from.
//
// Nothing touches flash until the whole recipe has checked out, which the recipe's own CRC-32 and the
// decoder do at the end. So a dropped link just times out, and a recipe already saved is never at risk.
//
// Pure and Arduino-free, so test/test_recipe_upload can run it off-hardware. final_app handles the
// commands and saves the result with firewalker_recipe_store.h.

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "firewalker_pattern_list.h"
#include "firewalker_recipe.h"

namespace Firewalker {

// A line of data holds at most this many bytes, written as twice that many hex characters. It's what
// fits in REMOTE_COMMAND_MAX after "recipe data 240 ".
constexpr size_t RECIPE_DATA_MAX_BYTES = 15;
constexpr size_t RECIPE_DATA_MAX_HEX = RECIPE_DATA_MAX_BYTES * 2;
// The smallest possible recipe: a version, a 1-letter name, a layer count, and a checksum.
constexpr size_t RECIPE_MIN_BYTES = 8;

inline int8_t hexDigitValue(char c) {
  if (c >= '0' && c <= '9') return (int8_t)(c - '0');
  if (c >= 'a' && c <= 'f') return (int8_t)(c - 'a' + 10);
  if (c >= 'A' && c <= 'F') return (int8_t)(c - 'A' + 10);
  return -1;
}

class RecipeUpload {
 public:
  explicit RecipeUpload(uint32_t idleLimitMs) : idleLimitMs_(idleLimitMs) {}

  // Each of these returns an error for the reply, or nullptr if it worked.

  // Starts an upload, replacing any in progress. Whether there's room for it is the caller's check.
  const char* begin(const char* name, int32_t bytes, uint32_t nowMs) {
    if (!patternNameValid(name)) return "bad-name";
    if (recipeNameReserved(name)) return "name-reserved";
    if (bytes > (int32_t)RECIPE_MAX_BYTES) return "too-big";
    if (bytes < (int32_t)RECIPE_MIN_BYTES) return "short";
    copyPatternName(name_, name);
    size_ = (size_t)bytes;
    received_ = 0;
    active_ = true;
    lastLineMs_ = nowMs;
    return nullptr;
  }

  const char* data(int32_t offset, const char* hex, uint32_t nowMs) {
    if (!active_) return "no-upload";
    lastLineMs_ = nowMs;
    if (offset != (int32_t)received_) return "wrong-offset";

    const size_t length = strlen(hex);
    if (length == 0 || length % 2 != 0 || length > RECIPE_DATA_MAX_HEX) return "bad-hex";
    for (size_t i = 0; i < length; i++) {
      if (hexDigitValue(hex[i]) < 0) return "bad-hex";
    }
    const size_t count = length / 2;
    if (received_ + count > size_) return "too-big";
    for (size_t i = 0; i < count; i++) {
      bytes_[received_ + i] = (uint8_t)((hexDigitValue(hex[i * 2]) << 4) | hexDigitValue(hex[i * 2 + 1]));
    }
    received_ += count;
    return nullptr;
  }

  // Checks the whole recipe. On success the bytes are ready to save and the upload is over. On failure
  // it's over too, because a client has to start again from the beginning anyway.
  const char* finish(Recipe& decoded) {
    if (!active_) return "no-upload";
    active_ = false;
    if (received_ < size_) return "short";
    switch (decodeRecipe(bytes_, size_, decoded)) {
      case RecipeDecodeResult::Ok:
        break;
      case RecipeDecodeResult::BadChecksum:
        return "bad-checksum";
      case RecipeDecodeResult::BadVersion:
        return "unsupported-version";
      case RecipeDecodeResult::BadSize:
      case RecipeDecodeResult::BadRecipe:
        return "bad-recipe";
    }
    if (strcmp(decoded.name, name_) != 0) return "name-mismatch";
    return nullptr;
  }

  void cancel() { active_ = false; }

  // Whether an upload has gone quiet for too long, as a dropped link would.
  bool timedOut(uint32_t nowMs) const { return active_ && (nowMs - lastLineMs_) >= idleLimitMs_; }

  bool active() const { return active_; }
  size_t next() const { return received_; }
  const char* name() const { return name_; }
  const uint8_t* bytes() const { return bytes_; }
  size_t size() const { return size_; }

 private:
  uint32_t idleLimitMs_;
  bool active_ = false;
  char name_[PATTERN_NAME_SIZE] = "";
  uint8_t bytes_[RECIPE_MAX_BYTES];
  size_t size_ = 0;
  size_t received_ = 0;
  uint32_t lastLineMs_ = 0;
};

// Fills in a slot's description from a stored recipe's bytes. Returns false if they're damaged, so the
// slot counts as empty. A recipe in a version this firmware can't read is kept but not `readable`: it
// stays in the `recipes` list so it can be deleted or replaced, but can't be selected.
inline bool describeStoredRecipe(const uint8_t* bytes, size_t size, UploadedRecipe& out) {
  out = UploadedRecipe{};
  if (size < RECIPE_MIN_BYTES || size > RECIPE_MAX_BYTES) return false;
  const size_t body = size - 4;
  const uint32_t crc = (uint32_t)bytes[body] | ((uint32_t)bytes[body + 1] << 8) | ((uint32_t)bytes[body + 2] << 16) |
                       ((uint32_t)bytes[body + 3] << 24);
  if (crc != settingsCrc(bytes, body)) return false;

  // The name's place in the bytes is the one thing every version has to keep.
  const uint8_t nameLength = bytes[1];
  if (nameLength == 0 || nameLength > PATTERN_NAME_MAX_LENGTH || 2u + nameLength > body) return false;
  memcpy(out.name, &bytes[2], nameLength);
  out.name[nameLength] = '\0';
  if (!patternNameValid(out.name)) return false;

  out.used = true;
  out.readable = recipeVersionSupported(bytes[0]);
  out.size = (uint16_t)size;
  out.crc = crc;
  return true;
}

// The slot a recipe of this name goes in: its own if it's already here, or else the first free one.
// Returns -1 if there's no room.
inline int16_t uploadSlotFor(const UploadedRecipe* slots, uint8_t count, const char* name) {
  int16_t firstFree = -1;
  for (uint8_t i = 0; i < count; i++) {
    if (slots[i].used && strcmp(slots[i].name, name) == 0) return i;
    if (!slots[i].used && firstFree < 0) firstFree = i;
  }
  return firstFree;
}

}  // namespace Firewalker
