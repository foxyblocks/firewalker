#include <unity.h>
#include "firewalker_audio_level.h"

using namespace Firewalker;

static void test_dc_bias_is_silence() {
  const uint32_t samples[] = {750, 750, 750, 750};
  const AudioBlock block = measureAudioBlock(samples, 4);
  TEST_ASSERT_EQUAL_FLOAT(750.0f, block.mean);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, block.rms);
  TEST_ASSERT_EQUAL_UINT16(750, block.low);
  TEST_ASSERT_EQUAL_UINT16(750, block.high);
}

static void test_measures_signal_around_its_bias() {
  const uint32_t samples[] = {746, 754, 746, 754};
  const AudioBlock block = measureAudioBlock(samples, 4);
  TEST_ASSERT_EQUAL_FLOAT(4.0f, block.rms);
  TEST_ASSERT_EQUAL_UINT16(746, block.low);
  TEST_ASSERT_EQUAL_UINT16(754, block.high);
}

static void test_full_scale_and_empty_blocks_are_safe() {
  uint32_t samples[1024];
  for (size_t i = 0; i < 1024; i++) samples[i] = i % 2 ? 4095 : 0;
  TEST_ASSERT_EQUAL_FLOAT(2047.5f, measureAudioBlock(samples, 1024).rms);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, measureAudioBlock(nullptr, 0).rms);
}

static void test_noise_floor_and_full_level() {
  TEST_ASSERT_EQUAL_FLOAT(0.0f, audioLevelFromRms(1.0f, 2.0f, 32.0f));
  TEST_ASSERT_EQUAL_FLOAT(1.0f, audioLevelFromRms(64.0f, 2.0f, 32.0f));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.5f, audioLevelFromRms(8.0f, 2.0f, 32.0f));
  TEST_ASSERT_EQUAL_FLOAT(0.0f, audioLevelFromRms(NAN, 2.0f, 32.0f));
  TEST_ASSERT_EQUAL_FLOAT(0.0f, audioLevelFromRms(4.0f, 2.0f, 2.0f));
}

static void test_attack_is_fast_and_release_is_slow() {
  const float attack = smoothAudioLevel(0.0f, 1.0f, 20.0f, 20.0f, 180.0f);
  const float released = smoothAudioLevel(1.0f, 0.0f, 20.0f, 20.0f, 180.0f);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.6321f, attack);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.8948f, released);
  TEST_ASSERT_EQUAL_FLOAT(1.0f, smoothAudioLevel(0.0f, 1.0f, 20.0f, 0.0f, 180.0f));
}

static void test_quiet_calibration_ignores_a_short_click() {
  float quiet[30];
  for (size_t i = 0; i < 30; i++) quiet[i] = 5.0f;
  quiet[0] = 40.0f;
  TEST_ASSERT_EQUAL_UINT8(9, quietAudioNoiseFloor(quiet, 30));
}

static void test_gate_rejects_quiet_spikes_and_follows_music_after_opening() {
  AudioGate gate;
  TEST_ASSERT_FALSE(audioGateStep(gate, 13.77f, 9.0f, 1.5f, 2));
  TEST_ASSERT_FALSE(audioGateStep(gate, 5.0f, 9.0f, 1.5f, 2));
  TEST_ASSERT_FALSE(audioGateStep(gate, 24.0f, 9.0f, 1.5f, 2));
  TEST_ASSERT_FALSE(audioGateStep(gate, 5.0f, 9.0f, 1.5f, 2));
  TEST_ASSERT_FALSE(audioGateStep(gate, 24.0f, 9.0f, 1.5f, 2));
  TEST_ASSERT_TRUE(audioGateStep(gate, 24.0f, 9.0f, 1.5f, 2));
  TEST_ASSERT_TRUE(audioGateStep(gate, 13.77f, 9.0f, 1.5f, 2));
  TEST_ASSERT_FALSE(audioGateStep(gate, 5.0f, 9.0f, 1.5f, 2));
}

void setUp() {}
void tearDown() {}
static void test_waveform_removes_bias_and_retains_both_polarities() {
  const uint32_t samples[] = {2048, 3072, 2048, 1024};
  int8_t waveform[4];
  audioWaveform(samples, 4, 2048, waveform, 4);
  TEST_ASSERT_EQUAL_INT(0, waveform[0]);
  TEST_ASSERT_EQUAL_INT(64, waveform[1]);
  TEST_ASSERT_EQUAL_INT(0, waveform[2]);
  TEST_ASSERT_EQUAL_INT(-64, waveform[3]);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_waveform_removes_bias_and_retains_both_polarities);
  RUN_TEST(test_quiet_calibration_ignores_a_short_click);
  RUN_TEST(test_gate_rejects_quiet_spikes_and_follows_music_after_opening);
  RUN_TEST(test_dc_bias_is_silence);
  RUN_TEST(test_measures_signal_around_its_bias);
  RUN_TEST(test_full_scale_and_empty_blocks_are_safe);
  RUN_TEST(test_noise_floor_and_full_level);
  RUN_TEST(test_attack_is_fast_and_release_is_slow);
  return UNITY_END();
}
