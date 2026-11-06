#pragma once

// Converts microphone ADC blocks into a reusable 0..1 volume input. Subtracting
// each block's mean removes the microphone's resting voltage. The firmware service
// owns sampling and timing; these Arduino-free functions own level and smoothing.

#include <math.h>
#include <algorithm>
#include <stddef.h>
#include <stdint.h>

namespace Firewalker {

struct AudioBlock {
  uint16_t low;
  uint16_t high;
  float mean;
  float rms;
};

// RMS measures the changing part of the signal, so a constant bias is silence.
// Use wide accumulators because a full-scale block can overflow a 32-bit sum.
inline AudioBlock measureAudioBlock(const uint32_t* samples, size_t count) {
  if (count == 0) return {0, 0, 0.0f, 0.0f};
  uint16_t low = 4095;
  uint16_t high = 0;
  uint64_t sum = 0;
  uint64_t squares = 0;
  for (size_t i = 0; i < count; i++) {
    const uint16_t sample = samples[i] & 0xFFF;
    if (sample < low) low = sample;
    if (sample > high) high = sample;
    sum += sample;
    squares += (uint32_t)sample * sample;
  }
  const double mean = (double)sum / count;
  const double variance = (double)squares / count - mean * mean;
  return {low, high, (float)mean, sqrtf((float)fmax(0.0, variance))};
}

// A log scale gives quiet music some travel. The noise floor and full-volume RMS
// are ADC counts, calibrated for this microphone rather than the browser's input gain.
inline float audioLevelFromRms(float rms, float noiseFloor, float fullVolume) {
  if (!isfinite(rms) || rms <= noiseFloor || fullVolume <= noiseFloor || noiseFloor <= 0.0f) return 0.0f;
  if (rms >= fullVolume) return 1.0f;
  return logf(rms / noiseFloor) / logf(fullVolume / noiseFloor);
}

// A quiet-room threshold with headroom, ignoring a single click or tap among
// otherwise steady noise. Sorting is in place; the capture service owns the buffer.
inline uint8_t quietAudioNoiseFloor(float* levels, size_t count) {
  if (count == 0) return 2;
  std::sort(levels, levels + count);
  const float floor = ceilf(levels[(count - 1) * 9 / 10] * 1.5f + 1.0f);
  return (uint8_t)fminf(255.0f, fmaxf(2.0f, floor));
}

struct AudioGate {
  bool open = false;
  uint8_t loudBlocks = 0;
};

// Require a short run of louder blocks to open, then allow softer passages
// until sound drops below the room threshold. This rejects isolated clicks as
// well as small background spikes. Configure at least one required block.
inline bool audioGateStep(AudioGate& gate, float rms, float noiseFloor,
                          float openMultiplier, uint8_t requiredBlocks) {
  if (!isfinite(rms) || rms <= noiseFloor) {
    gate.open = false;
    gate.loudBlocks = 0;
    return false;
  }
  if (gate.open) return true;
  if (rms <= noiseFloor * openMultiplier) {
    gate.loudBlocks = 0;
    return false;
  }
  if (gate.loudBlocks < requiredBlocks) gate.loudBlocks++;
  gate.open = gate.loudBlocks >= requiredBlocks;
  return gate.open;
}

// Sensitivity changes the range above the measured room noise. At 100, twice
// the quiet threshold fills the bar; at 0 it needs 64 times that threshold.
inline float audioFullRms(float noiseFloor, uint8_t sensitivity) {
  return noiseFloor * powf(2.0f, 1.0f + (100.0f - sensitivity) / 20.0f);
}

inline float smoothAudioLevel(float previous, float target, float elapsedMs, float attackMs, float releaseMs) {
  const float timeMs = target > previous ? attackMs : releaseMs;
  if (timeMs <= 0.0f) return target;
  return previous + (target - previous) * (1.0f - expf(-elapsedMs / timeMs));
}

}  // namespace Firewalker
