// Checks the C++ recipe engine against frames saved from the designer's TypeScript engine, the
// reference. For each file in test/fixtures/recipe-frames/ it decodes the compiled test recipe, runs
// every frame of the shared motion script, and compares each saved frame. See that folder's README
// for the file formats. Regenerate them with `bun run reference-frames` in designer/.
//
// C++ floats and JavaScript doubles round slightly differently, so a channel can differ by 1. More
// than that means the two engines don't draw the same thing.

#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unity.h>

#include <string>
#include <vector>

#include "firewalker_recipe_engine.h"

using namespace Firewalker;

// PlatformIO runs tests from the project root.
static const std::string FIXTURE_DIR = "test/fixtures/recipe-frames/";
static const int MAX_DIFFERENCE = 1;

static std::vector<uint8_t> readFile(const std::string& path) {
  std::vector<uint8_t> bytes;
  FILE* file = fopen(path.c_str(), "rb");
  if (!file) return bytes;
  uint8_t buffer[4096];
  size_t got;
  while ((got = fread(buffer, 1, sizeof(buffer), file)) > 0) bytes.insert(bytes.end(), buffer, buffer + got);
  fclose(file);
  return bytes;
}

static uint16_t readU16(const std::vector<uint8_t>& bytes, size_t at) {
  return (uint16_t)(bytes[at] | (bytes[at + 1] << 8));
}

static float readF32(const std::vector<uint8_t>& bytes, size_t at) {
  float value;
  memcpy(&value, &bytes[at], sizeof(value));
  return value;
}

static std::vector<std::string> caseFiles() {
  std::vector<std::string> files;
  DIR* dir = opendir(FIXTURE_DIR.c_str());
  if (!dir) return files;
  while (dirent* entry = readdir(dir)) {
    const std::string name = entry->d_name;
    if (name.find("--") != std::string::npos && name.size() > 4 && name.compare(name.size() - 4, 4, ".bin") == 0) {
      files.push_back(name);
    }
  }
  closedir(dir);
  return files;
}

// Large enough for any layout in the fixtures, and static because it's too big for the stack.
static RecipeEngine<160> engine;
static Recipe recipe;

static void checkCase(const std::string& file, const std::vector<uint8_t>& inputs) {
  const std::string name = file.substr(0, file.find("--"));
  const std::vector<uint8_t> frames = readFile(FIXTURE_DIR + file);
  const std::vector<uint8_t> compiled = readFile(FIXTURE_DIR + "compiled/" + name + ".bin");
  TEST_ASSERT_TRUE_MESSAGE(frames.size() > 16, file.c_str());
  TEST_ASSERT_TRUE_MESSAGE(!compiled.empty(), name.c_str());
  TEST_ASSERT_EQUAL_MEMORY_MESSAGE("FWRF", frames.data(), 4, file.c_str());
  TEST_ASSERT_EQUAL_MESSAGE(RecipeDecodeResult::Ok, decodeRecipe(compiled.data(), compiled.size(), recipe), name.c_str());

  const StripLayout layout = {readU16(frames, 6), readU16(frames, 8), readU16(frames, 10)};
  const uint16_t checkEvery = readU16(frames, 12);
  const uint16_t saved = readU16(frames, 14);
  engine.start(&recipe, layout);

  const uint16_t frameCount = readU16(inputs, 6);
  size_t at = 16;
  for (uint16_t f = 0; f < frameCount; f++) {
    const size_t record = 8 + (size_t)f * 12;
    engine.update(readF32(inputs, record), inputs[record + 10] != 0, readF32(inputs, record + 4), readU16(inputs, record + 8));
    if ((f + 1) % checkEvery != 0) continue;

    for (uint16_t pixel = 0; pixel < layout.count; pixel++) {
      for (uint8_t channel = 0; channel < 3; channel++) {
        const int expected = frames[at++];
        const int got = engine.frameByte(pixel, channel);
        if (abs(expected - got) > MAX_DIFFERENCE) {
          char message[160];
          snprintf(message, sizeof(message), "%s: frame %u, pixel %u, channel %u: expected %d, got %d", file.c_str(), f, pixel,
                   channel, expected, got);
          TEST_FAIL_MESSAGE(message);
        }
      }
    }
  }
  TEST_ASSERT_EQUAL_MESSAGE(16 + (size_t)saved * layout.count * 3, at, file.c_str());
}

static void test_matches_every_reference_frame() {
  const std::vector<uint8_t> inputs = readFile(FIXTURE_DIR + "inputs.bin");
  TEST_ASSERT_TRUE_MESSAGE(inputs.size() > 8, "inputs.bin is missing. Tests run from the project root.");
  TEST_ASSERT_EQUAL_MEMORY("FWRI", inputs.data(), 4);

  const std::vector<std::string> files = caseFiles();
  // 11 test recipes on 2 layouts, so a broken path can't pass by finding nothing.
  TEST_ASSERT_GREATER_OR_EQUAL_MESSAGE(22, files.size(), "Too few reference frame files");
  for (const std::string& file : files) checkCase(file, inputs);
}

static std::vector<uint8_t> compiledRecipe(const char* name) {
  return readFile(FIXTURE_DIR + "compiled/" + name + ".bin");
}

static void test_is_repeatable_after_enter() {
  const std::vector<uint8_t> compiled = compiledRecipe("sparkle");
  TEST_ASSERT_EQUAL(RecipeDecodeResult::Ok, decodeRecipe(compiled.data(), compiled.size(), recipe));
  const StripLayout layout = {107, 72, 19};
  engine.start(&recipe, layout);
  for (int f = 0; f < 50; f++) engine.update(0.0f, f == 10, 0.5f, 16);
  uint8_t first[107 * 3];
  for (uint16_t i = 0; i < 107 * 3; i++) first[i] = engine.frameByte(i / 3, i % 3);

  engine.enter();
  for (int f = 0; f < 50; f++) engine.update(0.0f, f == 10, 0.5f, 16);
  for (uint16_t i = 0; i < 107 * 3; i++) TEST_ASSERT_EQUAL_UINT8(first[i], engine.frameByte(i / 3, i % 3));
}

static void test_a_stall_counts_as_the_longest_step() {
  const std::vector<uint8_t> compiled = compiledRecipe("chase-ring");
  TEST_ASSERT_EQUAL(RecipeDecodeResult::Ok, decodeRecipe(compiled.data(), compiled.size(), recipe));
  const StripLayout layout = {107, 72, 19};
  uint8_t capped[107 * 3];
  engine.start(&recipe, layout);
  engine.update(0.0f, false, 0.0f, RECIPE_MAX_DT_MS);
  for (uint16_t i = 0; i < 107 * 3; i++) capped[i] = engine.frameByte(i / 3, i % 3);

  engine.start(&recipe, layout);
  engine.update(0.0f, false, 0.0f, 60000);
  for (uint16_t i = 0; i < 107 * 3; i++) TEST_ASSERT_EQUAL_UINT8(capped[i], engine.frameByte(i / 3, i % 3));
}

// JavaScript's Math.round goes toward positive infinity on a half, and C's round goes away from zero.
// The two only differ on negative halves, which the frames might never land on exactly.
static void test_rounds_halves_the_way_javascript_does() {
  TEST_ASSERT_EQUAL_INT32(0, recipeRound(-0.5));
  TEST_ASSERT_EQUAL_INT32(-1, recipeRound(-1.5));
  TEST_ASSERT_EQUAL_INT32(1, recipeRound(0.5));
  TEST_ASSERT_EQUAL_INT32(-2, recipeRound(-1.6));
}

void setUp() {}
void tearDown() {}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_matches_every_reference_frame);
  RUN_TEST(test_is_repeatable_after_enter);
  RUN_TEST(test_a_stall_counts_as_the_longest_step);
  RUN_TEST(test_rounds_halves_the_way_javascript_does);
  return UNITY_END();
}
