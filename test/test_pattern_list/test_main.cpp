// Tests what a name means on a boot, and what the `patterns` reply lists:
// include/firewalker_pattern_list.h.

#include <string.h>
#include <unity.h>

#include "firewalker_pattern_list.h"
#include "firewalker_recipe.h"
#include "generated/recipe_builtins.h"

using namespace Firewalker;

static const uint8_t BYTES[] = {1};
static const BuiltInRecipe BUILT_INS[] = {{"rainbow-pool", BYTES, 1}, {"comet", BYTES, 1}};

static UploadedRecipe uploads[4];

static UploadedRecipe uploaded(const char* name) {
  UploadedRecipe recipe{};
  recipe.used = true;
  recipe.readable = true;
  copyPatternName(recipe.name, name);
  return recipe;
}

static PatternCatalog catalog() { return {BUILT_INS, 2, uploads, 4}; }

void setUp() { memset(uploads, 0, sizeof(uploads)); }
void tearDown() {}

static void test_only_recipes_are_selectable_patterns() {
  const PatternLookup off = findPattern(catalog(), "off");
  TEST_ASSERT_EQUAL(PatternSource::Off, off.source);
  const PatternLookup flow = findPattern(catalog(), "flow");
  TEST_ASSERT_EQUAL(PatternSource::Unknown, flow.source);
  const PatternLookup fireTrail = findPattern(catalog(), "fire-trail");
  TEST_ASSERT_EQUAL(PatternSource::Unknown, fireTrail.source);
}

static void test_finds_a_built_in() {
  const PatternLookup found = findPattern(catalog(), "comet");
  TEST_ASSERT_EQUAL(PatternSource::BuiltIn, found.source);
  TEST_ASSERT_EQUAL_UINT8(1, found.index);
}

static void test_finds_an_upload_in_any_slot() {
  uploads[2] = uploaded("sparks");
  const PatternLookup found = findPattern(catalog(), "sparks");
  TEST_ASSERT_EQUAL(PatternSource::Uploaded, found.source);
  TEST_ASSERT_EQUAL_UINT8(2, found.index);
}

static void test_an_unknown_name_is_unknown() {
  TEST_ASSERT_EQUAL(PatternSource::Unknown, findPattern(catalog(), "nothing").source);
}

static void test_an_empty_slot_is_not_a_pattern() {
  copyPatternName(uploads[0].name, "ghost");
  TEST_ASSERT_EQUAL(PatternSource::Unknown, findPattern(catalog(), "ghost").source);
}

static void test_an_upload_this_firmware_cant_read_is_not_a_pattern() {
  uploads[0] = uploaded("future");
  uploads[0].readable = false;
  TEST_ASSERT_EQUAL(PatternSource::Unknown, findPattern(catalog(), "future").source);
  const char* names[PATTERN_LIST_MAX];
  const uint8_t count = listPatterns(catalog(), names, PATTERN_LIST_MAX);
  for (uint8_t i = 0; i < count; i++) TEST_ASSERT_TRUE(strcmp(names[i], "future") != 0);
}

static void test_an_upload_hides_a_built_in_until_deleted() {
  uploads[1] = uploaded("comet");
  const PatternLookup found = findPattern(catalog(), "comet");
  TEST_ASSERT_EQUAL(PatternSource::Uploaded, found.source);
  TEST_ASSERT_EQUAL_UINT8(1, found.index);

  uploads[1].used = false;
  TEST_ASSERT_EQUAL(PatternSource::BuiltIn, findPattern(catalog(), "comet").source);
}

static void test_a_retired_native_name_can_be_an_uploaded_recipe() {
  uploads[0] = uploaded("flow");
  TEST_ASSERT_EQUAL(PatternSource::Uploaded, findPattern(catalog(), "flow").source);
}

static void test_lists_recipes_in_order_each_once() {
  uploads[0] = uploaded("zebra");
  uploads[2] = uploaded("comet");
  uploads[3] = uploaded("aurora");
  const char* names[PATTERN_LIST_MAX];
  const uint8_t count = listPatterns(catalog(), names, PATTERN_LIST_MAX);
  TEST_ASSERT_EQUAL_UINT8(4, count);
  TEST_ASSERT_EQUAL_STRING("aurora", names[0]);
  TEST_ASSERT_EQUAL_STRING("comet", names[1]);
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", names[2]);
  TEST_ASSERT_EQUAL_STRING("zebra", names[3]);
}

static void test_off_is_not_listed() {
  const char* names[PATTERN_LIST_MAX];
  const uint8_t count = listPatterns(catalog(), names, PATTERN_LIST_MAX);
  for (uint8_t i = 0; i < count; i++) TEST_ASSERT_TRUE(strcmp(names[i], "off") != 0);
}

static void test_the_list_stops_at_its_limit() {
  const char* names[3];
  uploads[0] = uploaded("zebra");
  TEST_ASSERT_EQUAL_UINT8(2, listPatterns(catalog(), names, 2));
  TEST_ASSERT_EQUAL_STRING("comet", names[0]);
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", names[1]);
}

static void test_only_off_is_reserved() {
  TEST_ASSERT_TRUE(recipeNameReserved(PATTERN_OFF));
  TEST_ASSERT_FALSE(recipeNameReserved("flow"));
  TEST_ASSERT_FALSE(recipeNameReserved("fire-trail"));
  TEST_ASSERT_EQUAL_UINT8(1, sizeof(RECIPE_RESERVED_NAMES) / sizeof(RECIPE_RESERVED_NAMES[0]));
}

// Restoring settings uses the real shipped recipes, including while off. The rename must
// leave every other saved field alone, and an upload using an old name is still selectable.
static void test_saved_native_patterns_restore_as_their_recipe_counterparts() {
  const PatternCatalog shipped = {RECIPE_BUILTINS, RECIPE_BUILTIN_COUNT, uploads, 4};
  Settings settings = defaultSettings(32, {110, 40, 90});
  copyPatternName(settings.pattern, "flow");
  copyPatternName(settings.lastLitPattern, "fire-trail");
  settings.orientation.neutralSet = true;
  settings.orientation.neutral = {0.0f, 1.0f, 0.0f};
  settings.orientation.heelSet = true;
  settings.orientation.heel = {0.0f, 0.8f, -0.6f};
  const Settings before = settings;
  TEST_ASSERT_TRUE(restoreSavedPatterns(shipped, settings));
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", settings.pattern);
  TEST_ASSERT_EQUAL_STRING("fire-stomp", settings.lastLitPattern);
  TEST_ASSERT_EQUAL_UINT8(before.brightness, settings.brightness);
  TEST_ASSERT_EQUAL_UINT16(before.strip.toe, settings.strip.toe);
  TEST_ASSERT_TRUE(orientationCalibrated(settings.orientation));
  TEST_ASSERT_EQUAL_FLOAT(before.orientation.heel.z, settings.orientation.heel.z);
  TEST_ASSERT_FALSE(restoreSavedPatterns(shipped, settings));

  copyPatternName(settings.pattern, "off");
  copyPatternName(settings.lastLitPattern, "fire-trail");
  TEST_ASSERT_TRUE(restoreSavedPatterns(shipped, settings));
  TEST_ASSERT_EQUAL_STRING("off", settings.pattern);
  TEST_ASSERT_EQUAL_STRING("fire-stomp", settings.lastLitPattern);

  uploads[0] = uploaded("flow");
  copyPatternName(settings.pattern, "flow");
  TEST_ASSERT_FALSE(restoreSavedPatterns(shipped, settings));
  TEST_ASSERT_EQUAL_STRING("flow", settings.pattern);

  copyPatternName(settings.pattern, "deleted");
  copyPatternName(settings.lastLitPattern, "deleted");
  TEST_ASSERT_TRUE(restoreSavedPatterns(shipped, settings));
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", settings.pattern);
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", settings.lastLitPattern);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_only_recipes_are_selectable_patterns);
  RUN_TEST(test_finds_a_built_in);
  RUN_TEST(test_finds_an_upload_in_any_slot);
  RUN_TEST(test_an_unknown_name_is_unknown);
  RUN_TEST(test_an_empty_slot_is_not_a_pattern);
  RUN_TEST(test_an_upload_this_firmware_cant_read_is_not_a_pattern);
  RUN_TEST(test_an_upload_hides_a_built_in_until_deleted);
  RUN_TEST(test_a_retired_native_name_can_be_an_uploaded_recipe);
  RUN_TEST(test_lists_recipes_in_order_each_once);
  RUN_TEST(test_off_is_not_listed);
  RUN_TEST(test_the_list_stops_at_its_limit);
  RUN_TEST(test_only_off_is_reserved);
  RUN_TEST(test_saved_native_patterns_restore_as_their_recipe_counterparts);
  return UNITY_END();
}
