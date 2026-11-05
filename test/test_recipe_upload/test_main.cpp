// Tests receiving a recipe a piece at a time, and reading one back from flash:
// include/firewalker_recipe_upload.h. Recipes come from what the designer compiled, in
// test/fixtures/recipe-frames/compiled/.

#include <stdio.h>
#include <string.h>
#include <unity.h>

#include <string>
#include <vector>

#include "firewalker_recipe_upload.h"

using namespace Firewalker;

static const uint32_t IDLE_MS = 5000;
static Recipe decoded;

static std::vector<uint8_t> readCompiled(const std::string& name) {
  std::vector<uint8_t> bytes;
  FILE* file = fopen(("test/fixtures/recipe-frames/compiled/" + name + ".bin").c_str(), "rb");
  if (!file) return bytes;
  uint8_t buffer[512];
  size_t got;
  while ((got = fread(buffer, 1, sizeof(buffer), file)) > 0) bytes.insert(bytes.end(), buffer, buffer + got);
  fclose(file);
  return bytes;
}

static std::string toHex(const uint8_t* bytes, size_t count) {
  std::string hex;
  char digits[3];
  for (size_t i = 0; i < count; i++) {
    snprintf(digits, sizeof(digits), "%02x", bytes[i]);
    hex += digits;
  }
  return hex;
}

// Sends a recipe the way a client does: 15 bytes a line, each waiting on the one before.
static void sendAll(RecipeUpload& upload, const std::vector<uint8_t>& bytes) {
  for (size_t at = 0; at < bytes.size(); at += RECIPE_DATA_MAX_BYTES) {
    const size_t count = bytes.size() - at < RECIPE_DATA_MAX_BYTES ? bytes.size() - at : RECIPE_DATA_MAX_BYTES;
    TEST_ASSERT_NULL(upload.data((int32_t)at, toHex(&bytes[at], count).c_str(), 0));
    TEST_ASSERT_EQUAL_UINT32(at + count, upload.next());
  }
}

void setUp() {}
void tearDown() {}

static void test_receives_a_whole_recipe() {
  const std::vector<uint8_t> bytes = readCompiled("flash");
  TEST_ASSERT_FALSE(bytes.empty());
  RecipeUpload upload(IDLE_MS);
  TEST_ASSERT_NULL(upload.begin("flash", (int32_t)bytes.size(), 0));
  TEST_ASSERT_TRUE(upload.active());
  sendAll(upload, bytes);
  TEST_ASSERT_NULL(upload.finish(decoded));
  TEST_ASSERT_FALSE(upload.active());
  TEST_ASSERT_EQUAL_STRING("flash", decoded.name);
  TEST_ASSERT_EQUAL_UINT32(bytes.size(), upload.size());
  TEST_ASSERT_EQUAL_MEMORY(bytes.data(), upload.bytes(), bytes.size());
}

static void test_begin_refuses_bad_names_and_sizes() {
  RecipeUpload upload(IDLE_MS);
  TEST_ASSERT_EQUAL_STRING("bad-name", upload.begin("Not Good", 50, 0));
  TEST_ASSERT_EQUAL_STRING("name-reserved", upload.begin("flow", 50, 0));
  TEST_ASSERT_EQUAL_STRING("name-reserved", upload.begin("fire-trail", 50, 0));
  TEST_ASSERT_EQUAL_STRING("name-reserved", upload.begin("off", 50, 0));
  TEST_ASSERT_EQUAL_STRING("too-big", upload.begin("comet", RECIPE_MAX_BYTES + 1, 0));
  TEST_ASSERT_EQUAL_STRING("short", upload.begin("comet", 3, 0));
  TEST_ASSERT_FALSE(upload.active());
  TEST_ASSERT_NULL(upload.begin("comet", RECIPE_MAX_BYTES, 0));
}

static void test_data_needs_an_upload_in_progress() {
  RecipeUpload upload(IDLE_MS);
  TEST_ASSERT_EQUAL_STRING("no-upload", upload.data(0, "00", 0));
  TEST_ASSERT_EQUAL_STRING("no-upload", upload.finish(decoded));
}

static void test_a_line_out_of_order_changes_nothing_and_says_where_to_carry_on() {
  RecipeUpload upload(IDLE_MS);
  upload.begin("comet", 60, 0);
  TEST_ASSERT_NULL(upload.data(0, "0102", 0));
  TEST_ASSERT_EQUAL_STRING("wrong-offset", upload.data(0, "0102", 0));
  TEST_ASSERT_EQUAL_STRING("wrong-offset", upload.data(5, "0102", 0));
  TEST_ASSERT_EQUAL_UINT32(2, upload.next());
  TEST_ASSERT_NULL(upload.data(2, "03", 0));
  TEST_ASSERT_EQUAL_UINT8(3, upload.bytes()[2]);
}

static void test_refuses_bad_hex() {
  RecipeUpload upload(IDLE_MS);
  upload.begin("comet", 60, 0);
  TEST_ASSERT_EQUAL_STRING("bad-hex", upload.data(0, "", 0));
  TEST_ASSERT_EQUAL_STRING("bad-hex", upload.data(0, "abc", 0));
  TEST_ASSERT_EQUAL_STRING("bad-hex", upload.data(0, "zz", 0));
  TEST_ASSERT_EQUAL_STRING("bad-hex", upload.data(0, "0123456789abcdef0123456789abcdef", 0));
  TEST_ASSERT_EQUAL_UINT32(0, upload.next());
  TEST_ASSERT_NULL(upload.data(0, "aBcD", 0));
  TEST_ASSERT_EQUAL_UINT8(0xAB, upload.bytes()[0]);
  TEST_ASSERT_EQUAL_UINT8(0xCD, upload.bytes()[1]);
}

static void test_refuses_more_than_it_said_it_would_send() {
  RecipeUpload upload(IDLE_MS);
  upload.begin("comet", RECIPE_MIN_BYTES, 0);
  TEST_ASSERT_EQUAL_STRING("too-big", upload.data(0, "000000000000000000", 0));
}

static void test_refuses_a_recipe_cut_short() {
  RecipeUpload upload(IDLE_MS);
  upload.begin("comet", 60, 0);
  upload.data(0, "0102", 0);
  TEST_ASSERT_EQUAL_STRING("short", upload.finish(decoded));
  TEST_ASSERT_FALSE(upload.active());
}

static void test_refuses_a_damaged_recipe() {
  std::vector<uint8_t> bytes = readCompiled("flash");
  bytes[6] ^= 1;
  RecipeUpload upload(IDLE_MS);
  upload.begin("flash", (int32_t)bytes.size(), 0);
  sendAll(upload, bytes);
  TEST_ASSERT_EQUAL_STRING("bad-checksum", upload.finish(decoded));
}

static void fixChecksum(std::vector<uint8_t>& bytes) {
  const size_t body = bytes.size() - 4;
  const uint32_t crc = settingsCrc(bytes.data(), body);
  for (uint8_t i = 0; i < 4; i++) bytes[body + i] = (uint8_t)(crc >> (8 * i));
}

static void test_refuses_a_version_it_cant_read() {
  std::vector<uint8_t> bytes = readCompiled("flash");
  bytes[0] = RECIPE_VERSION + 1;
  fixChecksum(bytes);
  RecipeUpload upload(IDLE_MS);
  upload.begin("flash", (int32_t)bytes.size(), 0);
  sendAll(upload, bytes);
  TEST_ASSERT_EQUAL_STRING("unsupported-version", upload.finish(decoded));
}

static void test_refuses_nonsense_with_a_good_checksum() {
  std::vector<uint8_t> bytes(20, 0xEE);
  bytes[0] = RECIPE_VERSION;
  fixChecksum(bytes);
  RecipeUpload upload(IDLE_MS);
  upload.begin("flash", (int32_t)bytes.size(), 0);
  sendAll(upload, bytes);
  TEST_ASSERT_EQUAL_STRING("bad-recipe", upload.finish(decoded));
}

static void test_refuses_a_name_that_doesnt_match_begin() {
  const std::vector<uint8_t> bytes = readCompiled("flash");
  RecipeUpload upload(IDLE_MS);
  upload.begin("comet", (int32_t)bytes.size(), 0);
  sendAll(upload, bytes);
  TEST_ASSERT_EQUAL_STRING("name-mismatch", upload.finish(decoded));
}

static void test_a_new_begin_replaces_an_upload_in_progress() {
  const std::vector<uint8_t> bytes = readCompiled("pool");
  RecipeUpload upload(IDLE_MS);
  upload.begin("comet", 60, 0);
  upload.data(0, "0102", 0);
  TEST_ASSERT_NULL(upload.begin("pool", (int32_t)bytes.size(), 0));
  TEST_ASSERT_EQUAL_UINT32(0, upload.next());
  sendAll(upload, bytes);
  TEST_ASSERT_NULL(upload.finish(decoded));
}

static void test_cancel_ends_an_upload() {
  RecipeUpload upload(IDLE_MS);
  upload.begin("comet", 60, 0);
  upload.cancel();
  TEST_ASSERT_FALSE(upload.active());
  TEST_ASSERT_EQUAL_STRING("no-upload", upload.data(0, "00", 0));
}

static void test_goes_quiet_after_the_idle_limit_counting_from_the_last_line() {
  RecipeUpload upload(IDLE_MS);
  TEST_ASSERT_FALSE(upload.timedOut(1000000));
  upload.begin("comet", 60, 1000);
  TEST_ASSERT_FALSE(upload.timedOut(5999));
  upload.data(0, "00", 5000);
  TEST_ASSERT_FALSE(upload.timedOut(9999));
  TEST_ASSERT_TRUE(upload.timedOut(10000));
  upload.cancel();
  TEST_ASSERT_FALSE(upload.timedOut(100000));
}

static void test_describes_a_stored_recipe() {
  const std::vector<uint8_t> bytes = readCompiled("trail-end");
  UploadedRecipe slot;
  TEST_ASSERT_TRUE(describeStoredRecipe(bytes.data(), bytes.size(), slot));
  TEST_ASSERT_TRUE(slot.used);
  TEST_ASSERT_TRUE(slot.readable);
  TEST_ASSERT_EQUAL_STRING("trail-end", slot.name);
  TEST_ASSERT_EQUAL_UINT16(bytes.size(), slot.size);
  TEST_ASSERT_EQUAL_UINT32(settingsCrc(bytes.data(), bytes.size() - 4), slot.crc);
}

static void test_a_damaged_stored_recipe_counts_as_empty() {
  std::vector<uint8_t> bytes = readCompiled("flash");
  bytes[6] ^= 1;
  UploadedRecipe slot;
  TEST_ASSERT_FALSE(describeStoredRecipe(bytes.data(), bytes.size(), slot));
  TEST_ASSERT_FALSE(slot.used);
  TEST_ASSERT_FALSE(describeStoredRecipe(bytes.data(), 3, slot));
  TEST_ASSERT_FALSE(describeStoredRecipe(bytes.data(), RECIPE_MAX_BYTES + 1, slot));
}

static void test_a_stored_recipe_of_a_newer_version_is_kept_but_not_readable() {
  std::vector<uint8_t> bytes = readCompiled("flash");
  bytes[0] = RECIPE_VERSION + 1;
  fixChecksum(bytes);
  UploadedRecipe slot;
  TEST_ASSERT_TRUE(describeStoredRecipe(bytes.data(), bytes.size(), slot));
  TEST_ASSERT_TRUE(slot.used);
  TEST_ASSERT_FALSE(slot.readable);
  TEST_ASSERT_EQUAL_STRING("flash", slot.name);
}

static void test_a_stored_recipe_with_a_bad_name_counts_as_empty() {
  std::vector<uint8_t> bytes = readCompiled("flash");
  bytes[1] = 200;
  fixChecksum(bytes);
  UploadedRecipe slot;
  TEST_ASSERT_FALSE(describeStoredRecipe(bytes.data(), bytes.size(), slot));
  bytes[1] = 2;
  bytes[2] = 'A';
  fixChecksum(bytes);
  TEST_ASSERT_FALSE(describeStoredRecipe(bytes.data(), bytes.size(), slot));
}

static void test_picks_a_recipes_own_slot_or_the_first_free_one() {
  UploadedRecipe slots[3] = {};
  TEST_ASSERT_EQUAL_INT16(0, uploadSlotFor(slots, 3, "comet"));
  slots[0].used = true;
  copyPatternName(slots[0].name, "comet");
  TEST_ASSERT_EQUAL_INT16(0, uploadSlotFor(slots, 3, "comet"));
  TEST_ASSERT_EQUAL_INT16(1, uploadSlotFor(slots, 3, "lava"));
  slots[1].used = true;
  copyPatternName(slots[1].name, "lava");
  slots[2].used = true;
  copyPatternName(slots[2].name, "sky");
  TEST_ASSERT_EQUAL_INT16(1, uploadSlotFor(slots, 3, "lava"));
  TEST_ASSERT_EQUAL_INT16(-1, uploadSlotFor(slots, 3, "new"));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_receives_a_whole_recipe);
  RUN_TEST(test_begin_refuses_bad_names_and_sizes);
  RUN_TEST(test_data_needs_an_upload_in_progress);
  RUN_TEST(test_a_line_out_of_order_changes_nothing_and_says_where_to_carry_on);
  RUN_TEST(test_refuses_bad_hex);
  RUN_TEST(test_refuses_more_than_it_said_it_would_send);
  RUN_TEST(test_refuses_a_recipe_cut_short);
  RUN_TEST(test_refuses_a_damaged_recipe);
  RUN_TEST(test_refuses_a_version_it_cant_read);
  RUN_TEST(test_refuses_nonsense_with_a_good_checksum);
  RUN_TEST(test_refuses_a_name_that_doesnt_match_begin);
  RUN_TEST(test_a_new_begin_replaces_an_upload_in_progress);
  RUN_TEST(test_cancel_ends_an_upload);
  RUN_TEST(test_goes_quiet_after_the_idle_limit_counting_from_the_last_line);
  RUN_TEST(test_describes_a_stored_recipe);
  RUN_TEST(test_a_damaged_stored_recipe_counts_as_empty);
  RUN_TEST(test_a_stored_recipe_of_a_newer_version_is_kept_but_not_readable);
  RUN_TEST(test_a_stored_recipe_with_a_bad_name_counts_as_empty);
  RUN_TEST(test_picks_a_recipes_own_slot_or_the_first_free_one);
  return UNITY_END();
}
