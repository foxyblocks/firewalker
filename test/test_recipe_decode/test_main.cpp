// Tests the recipe decoder in include/firewalker_recipe.h against recipes the designer compiled, and
// against damaged ones. Uploads come from anyone in Bluetooth range, so the promise that matters is
// that no input crashes a boot: every recipe is either refused, or safe for the engine to run. These
// tests run with memory checks on (see the native environment in platformio.ini), so a read past
// the end of a buffer fails them too.

#include <dirent.h>
#include <stdio.h>
#include <string.h>
#include <unity.h>

#include <string>
#include <vector>

#include "firewalker_recipe_engine.h"

using namespace Firewalker;

static const std::string COMPILED_DIR = "test/fixtures/recipe-frames/compiled/";

static Recipe recipe;
static RecipeEngine<160> engine;

static std::vector<uint8_t> readCompiled(const std::string& name) {
  std::vector<uint8_t> bytes;
  FILE* file = fopen((COMPILED_DIR + name + ".bin").c_str(), "rb");
  if (!file) return bytes;
  uint8_t buffer[512];
  size_t got;
  while ((got = fread(buffer, 1, sizeof(buffer), file)) > 0) bytes.insert(bytes.end(), buffer, buffer + got);
  fclose(file);
  return bytes;
}

static std::vector<std::string> compiledNames() {
  std::vector<std::string> names;
  DIR* dir = opendir(COMPILED_DIR.c_str());
  if (!dir) return names;
  while (dirent* entry = readdir(dir)) {
    const std::string name = entry->d_name;
    if (name.size() > 4 && name.compare(name.size() - 4, 4, ".bin") == 0) names.push_back(name.substr(0, name.size() - 4));
  }
  closedir(dir);
  return names;
}

// Replaces the checksum on the end, so a change reaches the checks after it.
static void fixChecksum(std::vector<uint8_t>& bytes) {
  const size_t body = bytes.size() - 4;
  const uint32_t crc = settingsCrc(bytes.data(), body);
  for (uint8_t i = 0; i < 4; i++) bytes[body + i] = (uint8_t)(crc >> (8 * i));
}

// A recipe's bytes from the parts before the checksum.
static std::vector<uint8_t> withChecksum(std::vector<uint8_t> body) {
  body.insert(body.end(), 4, 0);
  fixChecksum(body);
  return body;
}

// The start of a recipe named "ab" with one layer. The layer's bytes follow it.
static std::vector<uint8_t> recipeNamedAb(std::vector<uint8_t> layer) {
  std::vector<uint8_t> body = {RECIPE_VERSION, 2, 'a', 'b', 1};
  body.insert(body.end(), layer.begin(), layer.end());
  return withChecksum(body);
}

static RecipeDecodeResult decode(const std::vector<uint8_t>& bytes) {
  return decodeRecipe(bytes.data(), bytes.size(), recipe);
}

static void test_every_compiled_recipe_decodes() {
  const std::vector<std::string> names = compiledNames();
  TEST_ASSERT_GREATER_OR_EQUAL_MESSAGE(11, names.size(), "Compiled recipes are missing. Tests run from the project root.");
  for (const std::string& name : names) {
    TEST_ASSERT_EQUAL_MESSAGE(RecipeDecodeResult::Ok, decode(readCompiled(name)), name.c_str());
    TEST_ASSERT_EQUAL_STRING(name.c_str(), recipe.name);
  }
}

static void test_reads_a_fill_and_a_pool() {
  TEST_ASSERT_EQUAL(RecipeDecodeResult::Ok, decode(readCompiled("pool")));
  TEST_ASSERT_EQUAL_UINT8(2, recipe.layerCount);

  const RecipeLayer& fill = recipe.layers[0];
  TEST_ASSERT_EQUAL(RecipeLayerType::Fill, fill.type);
  TEST_ASSERT_EQUAL_UINT8(1, fill.paletteCount);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, fill.palette[0][0]);
  TEST_ASSERT_EQUAL_FLOAT(1.0f, fill.palette[0][1]);
  TEST_ASSERT_EQUAL_FLOAT(128.0f / 255.0f, fill.palette[0][2]);
  TEST_ASSERT_EQUAL(RecipeSpread::Solid, (RecipeSpread)fill.choices[RecipeSlot::FillSpread]);
  TEST_ASSERT_FALSE(fill.knobs[RecipeSlot::FillRepeat].bound);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, fill.knobs[RecipeSlot::FillRepeat].min);

  const RecipeLayer& pool = recipe.layers[1];
  TEST_ASSERT_EQUAL(RecipeLayerType::Pool, pool.type);
  TEST_ASSERT_EQUAL(RecipeBlend::Multiply, (RecipeBlend)pool.choices[RECIPE_BLEND_SLOT]);
  const RecipeKnob& baseline = pool.knobs[RecipeSlot::PoolBaseline];
  TEST_ASSERT_TRUE(baseline.bound);
  TEST_ASSERT_EQUAL(RecipeSource::Wave, baseline.source);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.2f, baseline.min);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.9f, baseline.max);
  TEST_ASSERT_EQUAL_UINT16(3000, baseline.ms);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, pool.knobs[RECIPE_OPACITY_SLOT].min);
}

static void test_reads_a_trail() {
  TEST_ASSERT_EQUAL(RecipeDecodeResult::Ok, decode(readCompiled("trail-end")));
  const RecipeLayer& trail = recipe.layers[0];
  TEST_ASSERT_EQUAL(RecipeTrigger::Tilted, (RecipeTrigger)trail.choices[RecipeSlot::TrailTrigger]);
  TEST_ASSERT_EQUAL(RecipeTrailOrigin::DownEnd, (RecipeTrailOrigin)trail.choices[RecipeSlot::TrailFrom]);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.3f, trail.numbers[RecipeSlot::TrailFlatZone]);
  TEST_ASSERT_EQUAL_FLOAT(8.0f, trail.numbers[RecipeSlot::TrailLength]);
  TEST_ASSERT_EQUAL_FLOAT(3.0f, trail.numbers[RecipeSlot::TrailMaxFronts]);
  const RecipeKnob& speed = trail.knobs[RecipeSlot::TrailSpeed];
  TEST_ASSERT_TRUE(speed.bound);
  TEST_ASSERT_EQUAL(RecipeSource::Tilt, speed.source);
  TEST_ASSERT_FLOAT_WITHIN(0.02f, 20.0f, speed.min);
  TEST_ASSERT_FLOAT_WITHIN(0.02f, 200.0f, speed.max);
}

static void test_refuses_the_wrong_size() {
  uint8_t bytes[RECIPE_MAX_BYTES + 1] = {0};
  for (size_t size = 0; size < 8; size++) TEST_ASSERT_EQUAL(RecipeDecodeResult::BadSize, decodeRecipe(bytes, size, recipe));
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadSize, decodeRecipe(bytes, sizeof(bytes), recipe));
}

static void test_refuses_a_damaged_byte() {
  std::vector<uint8_t> bytes = readCompiled("pool");
  bytes[6] ^= 1;
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadChecksum, decode(bytes));
}

static void test_refuses_another_version() {
  std::vector<uint8_t> bytes = readCompiled("pool");
  bytes[0] = RECIPE_VERSION + 1;
  fixChecksum(bytes);
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadVersion, decode(bytes));
}

static void test_refuses_a_recipe_cut_short_even_with_a_good_checksum() {
  const std::vector<uint8_t> bytes = readCompiled("flash");
  for (size_t body = 4; body + 4 < bytes.size(); body++) {
    const std::vector<uint8_t> cut = withChecksum(std::vector<uint8_t>(bytes.begin(), bytes.begin() + (long)body));
    TEST_ASSERT_EQUAL(RecipeDecodeResult::BadRecipe, decode(cut));
  }
}

static void test_refuses_extra_bytes() {
  std::vector<uint8_t> body = readCompiled("pool");
  body.resize(body.size() - 4);
  body.push_back(0);
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadRecipe, decode(withChecksum(body)));
}

static void test_refuses_bad_names() {
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadRecipe, decode(withChecksum({RECIPE_VERSION, 0, 1, 1})));
  std::vector<uint8_t> tooLong = {RECIPE_VERSION, 13};
  tooLong.insert(tooLong.end(), 13, 'a');
  tooLong.push_back(1);
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadRecipe, decode(withChecksum(tooLong)));
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadRecipe, decode(withChecksum({RECIPE_VERSION, 2, 'A', 'b', 1})));
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadRecipe, decode(withChecksum({RECIPE_VERSION, 3, 'o', 'f', 'f', 1})));
}

static void test_refuses_the_wrong_number_of_layers() {
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadRecipe, decode(withChecksum({RECIPE_VERSION, 2, 'a', 'b', 0})));
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadRecipe, decode(withChecksum({RECIPE_VERSION, 2, 'a', 'b', RECIPE_MAX_LAYERS + 1})));
}

static void test_refuses_unknown_types_options_and_sources() {
  const uint8_t pool = (uint8_t)RecipeLayerType::Pool;
  const uint8_t fill = (uint8_t)RecipeLayerType::Fill;
  // A valid pool is: type, mask, baseline, blend, opacity.
  TEST_ASSERT_EQUAL(RecipeDecodeResult::Ok, decode(recipeNamedAb({pool, 0, 0, 0, 3, 0, 0})));
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadRecipe, decode(recipeNamedAb({(uint8_t)RecipeLayerType::Chase + 1, 0})));
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadRecipe, decode(recipeNamedAb({pool, 0, 0, 0, 4, 0, 0})));
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadRecipe, decode(recipeNamedAb({pool, 1, 5, 0, 0, 0, 0, 0, 0, 0})));
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadRecipe, decode(recipeNamedAb({fill, 0, 0})));
  TEST_ASSERT_EQUAL(RecipeDecodeResult::BadRecipe, decode(recipeNamedAb({fill, 0, RECIPE_MAX_PALETTE_STOPS + 1})));
}

static void test_limits_numbers_to_their_ranges() {
  const uint8_t pool = (uint8_t)RecipeLayerType::Pool;
  // A pool's baseline runs from 0 to 1, and a raw -32767 would read as -1.
  TEST_ASSERT_EQUAL(RecipeDecodeResult::Ok, decode(recipeNamedAb({pool, 0, 0x01, 0x80, 0, 0xFF, 0x7F})));
  TEST_ASSERT_EQUAL_FLOAT(0.0f, recipe.layers[0].knobs[RecipeSlot::PoolBaseline].min);
  TEST_ASSERT_EQUAL_FLOAT(1.0f, recipe.layers[0].knobs[RECIPE_OPACITY_SLOT].min);

  // A wave's period is limited too: 0 becomes the shortest, so it can't divide by zero.
  TEST_ASSERT_EQUAL(RecipeDecodeResult::Ok,
                    decode(recipeNamedAb({pool, 1, (uint8_t)RecipeSource::Wave, 0, 0, 0xFF, 0x7F, 0, 0, 0, 0, 0})));
  TEST_ASSERT_EQUAL_UINT16(RECIPE_WAVE_PERIOD_MIN, recipe.layers[0].knobs[RecipeSlot::PoolBaseline].ms);
}

// Everything a decoded recipe promises the engine.
static void assertRecipeIsSafe() {
  TEST_ASSERT_TRUE(recipe.layerCount >= 1 && recipe.layerCount <= RECIPE_MAX_LAYERS);
  for (uint8_t l = 0; l < recipe.layerCount; l++) {
    const RecipeLayer& layer = recipe.layers[l];
    TEST_ASSERT_TRUE((uint8_t)layer.type <= (uint8_t)RecipeLayerType::Chase);
    const RecipeLayerInfo& info = RECIPE_LAYERS[(uint8_t)layer.type];
    for (uint8_t f = 0; f < info.count; f++) {
      const RecipeFieldInfo& field = info.fields[f];
      switch (field.kind) {
        case RecipeFieldKind::Choice:
          TEST_ASSERT_TRUE(layer.choices[field.slot] <= (uint8_t)field.max);
          break;
        case RecipeFieldKind::Whole:
        case RecipeFieldKind::Fraction:
          TEST_ASSERT_TRUE(layer.numbers[field.slot] >= field.min && layer.numbers[field.slot] <= field.max);
          break;
        case RecipeFieldKind::Palette:
          TEST_ASSERT_TRUE(layer.paletteCount >= 1 && layer.paletteCount <= RECIPE_MAX_PALETTE_STOPS);
          break;
        case RecipeFieldKind::Knob: {
          const RecipeKnob& knob = layer.knobs[field.slot];
          TEST_ASSERT_TRUE(knob.min >= field.min && knob.min <= field.max);
          TEST_ASSERT_TRUE(knob.max >= field.min && knob.max <= field.max);
          TEST_ASSERT_TRUE((uint8_t)knob.source <= (uint8_t)RecipeSource::Wave);
          if (knob.bound && knob.source == RecipeSource::Wave) TEST_ASSERT_TRUE(knob.ms >= RECIPE_WAVE_PERIOD_MIN);
          if (knob.bound && knob.source == RecipeSource::StompFade) TEST_ASSERT_TRUE(knob.ms >= RECIPE_STOMP_FADE_MIN);
          break;
        }
      }
    }
  }
}

// Changes every byte of every test recipe to several values, with the checksum fixed so the change
// reaches the decoder. Anything accepted has to be safe to run, on an odd strip layout too.
static void test_survives_any_change_to_any_byte() {
  const StripLayout layouts[] = {{160, 52, 132}, {107, 72, 19}, {2, 0, 1}};
  const uint8_t values[] = {0x00, 0x01, 0x7F, 0x80, 0xFF};
  uint32_t accepted = 0;
  for (const std::string& name : compiledNames()) {
    const std::vector<uint8_t> original = readCompiled(name);
    for (size_t at = 0; at + 4 < original.size(); at++) {
      for (uint8_t variant = 0; variant < 6; variant++) {
        std::vector<uint8_t> bytes = original;
        bytes[at] = variant < 5 ? values[variant] : (uint8_t)(original[at] ^ 0x55);
        fixChecksum(bytes);
        if (decode(bytes) != RecipeDecodeResult::Ok) continue;
        accepted++;
        assertRecipeIsSafe();
        for (const StripLayout& layout : layouts) {
          engine.start(&recipe, layout);
          for (int f = 0; f < 12; f++) engine.update(f % 3 == 0 ? 0.0f : 0.7f, f % 4 == 1, 1.0f, 40);
        }
      }
    }
  }
  // Most small changes still decode, so this has really run the engine on damaged recipes.
  TEST_ASSERT_GREATER_THAN_UINT32(1000, accepted);
}

static void test_checks_a_name_is_spelled_legally() {
  TEST_ASSERT_TRUE(patternNameValid("fire-stomp"));
  TEST_ASSERT_TRUE(patternNameValid("abcdefghijkl"));
  TEST_ASSERT_TRUE(patternNameValid("a"));
  TEST_ASSERT_FALSE(patternNameValid(""));
  TEST_ASSERT_FALSE(patternNameValid("abcdefghijklm"));
  TEST_ASSERT_FALSE(patternNameValid("Lava"));
  TEST_ASSERT_FALSE(patternNameValid("9lives"));
  TEST_ASSERT_FALSE(patternNameValid("-dash"));
  TEST_ASSERT_FALSE(patternNameValid("../etc"));
  TEST_ASSERT_FALSE(patternNameValid("two words"));
}

static void test_knows_the_reserved_names() {
  TEST_ASSERT_TRUE(recipeNameReserved("off"));
  TEST_ASSERT_TRUE(recipeNameReserved("flow"));
  TEST_ASSERT_TRUE(recipeNameReserved("fire-trail"));
  TEST_ASSERT_FALSE(recipeNameReserved("comet"));
}

void setUp() {}
void tearDown() {}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_every_compiled_recipe_decodes);
  RUN_TEST(test_reads_a_fill_and_a_pool);
  RUN_TEST(test_reads_a_trail);
  RUN_TEST(test_refuses_the_wrong_size);
  RUN_TEST(test_refuses_a_damaged_byte);
  RUN_TEST(test_refuses_another_version);
  RUN_TEST(test_refuses_a_recipe_cut_short_even_with_a_good_checksum);
  RUN_TEST(test_refuses_extra_bytes);
  RUN_TEST(test_refuses_bad_names);
  RUN_TEST(test_refuses_the_wrong_number_of_layers);
  RUN_TEST(test_refuses_unknown_types_options_and_sources);
  RUN_TEST(test_limits_numbers_to_their_ranges);
  RUN_TEST(test_survives_any_change_to_any_byte);
  RUN_TEST(test_checks_a_name_is_spelled_legally);
  RUN_TEST(test_knows_the_reserved_names);
  return UNITY_END();
}
