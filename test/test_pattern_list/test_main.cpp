// Tests what a name means on a boot, and what the `patterns` reply lists:
// include/firewalker_pattern_list.h.

#include <string.h>
#include <unity.h>

#include "firewalker_pattern_list.h"
#include "firewalker_recipe.h"

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

static void test_finds_off_and_the_native_patterns() {
  const PatternLookup off = findPattern(catalog(), "off");
  TEST_ASSERT_EQUAL(PatternSource::Off, off.source);
  const PatternLookup flow = findPattern(catalog(), "flow");
  TEST_ASSERT_EQUAL(PatternSource::Native, flow.source);
  TEST_ASSERT_EQUAL_UINT8(0, flow.index);
  const PatternLookup fireTrail = findPattern(catalog(), "fire-trail");
  TEST_ASSERT_EQUAL(PatternSource::Native, fireTrail.source);
  TEST_ASSERT_EQUAL_UINT8(1, fireTrail.index);
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

static void test_a_native_name_always_means_the_native_pattern() {
  uploads[0] = uploaded("flow");
  TEST_ASSERT_EQUAL(PatternSource::Native, findPattern(catalog(), "flow").source);
}

static void test_lists_natives_then_the_recipes_in_order_each_once() {
  uploads[0] = uploaded("zebra");
  uploads[2] = uploaded("comet");
  uploads[3] = uploaded("aurora");
  const char* names[PATTERN_LIST_MAX];
  const uint8_t count = listPatterns(catalog(), names, PATTERN_LIST_MAX);
  TEST_ASSERT_EQUAL_UINT8(6, count);
  TEST_ASSERT_EQUAL_STRING("flow", names[0]);
  TEST_ASSERT_EQUAL_STRING("fire-trail", names[1]);
  TEST_ASSERT_EQUAL_STRING("aurora", names[2]);
  TEST_ASSERT_EQUAL_STRING("comet", names[3]);
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", names[4]);
  TEST_ASSERT_EQUAL_STRING("zebra", names[5]);
}

static void test_off_is_not_listed() {
  const char* names[PATTERN_LIST_MAX];
  const uint8_t count = listPatterns(catalog(), names, PATTERN_LIST_MAX);
  for (uint8_t i = 0; i < count; i++) TEST_ASSERT_TRUE(strcmp(names[i], "off") != 0);
}

static void test_the_list_stops_at_its_limit() {
  const char* names[3];
  TEST_ASSERT_EQUAL_UINT8(3, listPatterns(catalog(), names, 3));
  TEST_ASSERT_EQUAL_STRING("rainbow-pool", names[2]);
}

// A recipe can't take a native pattern's name, so the format's reserved names have to cover them.
static void test_the_formats_reserved_names_cover_off_and_the_native_patterns() {
  TEST_ASSERT_TRUE(recipeNameReserved(PATTERN_OFF));
  for (const char* name : NATIVE_PATTERNS) TEST_ASSERT_TRUE_MESSAGE(recipeNameReserved(name), name);
  TEST_ASSERT_EQUAL_UINT8(NATIVE_PATTERN_COUNT + 1, sizeof(RECIPE_RESERVED_NAMES) / sizeof(RECIPE_RESERVED_NAMES[0]));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_finds_off_and_the_native_patterns);
  RUN_TEST(test_finds_a_built_in);
  RUN_TEST(test_finds_an_upload_in_any_slot);
  RUN_TEST(test_an_unknown_name_is_unknown);
  RUN_TEST(test_an_empty_slot_is_not_a_pattern);
  RUN_TEST(test_an_upload_this_firmware_cant_read_is_not_a_pattern);
  RUN_TEST(test_an_upload_hides_a_built_in_until_deleted);
  RUN_TEST(test_a_native_name_always_means_the_native_pattern);
  RUN_TEST(test_lists_natives_then_the_recipes_in_order_each_once);
  RUN_TEST(test_off_is_not_listed);
  RUN_TEST(test_the_list_stops_at_its_limit);
  RUN_TEST(test_the_formats_reserved_names_cover_off_and_the_native_patterns);
  return UNITY_END();
}
