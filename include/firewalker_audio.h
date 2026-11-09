#pragma once

#include <stdint.h>
#include "firewalker_audio_level.h"

// The MG24 Sense's analog microphone service. It owns IADC0 and one shared DMA
// channel, sampling PC9 in short timed blocks while motion, LEDs, and BLE keep
// running. final_app calls audioUpdate() and feeds audioLevel() to PatternInput.
// Sampling pins and timing live in config.h. The boot saves its quiet threshold
// and sensitivity in Settings. Other services must leave IADC0 available while
// capture runs. Quiet calibration uses about 1.2 seconds of background samples.

namespace Firewalker {

struct AudioSample {
  AudioBlock block;
  float level;
  uint32_t blocks;
  uint32_t captureUs;
  int8_t waveform[AUDIO_WAVEFORM_SIZE];
};

// Sensitivity is 0..100, with larger values needing less sound for a full bar.
void audioConfigure(uint8_t noiseFloor, uint8_t sensitivity);
bool audioBegin();
bool audioStartQuietCalibration();
bool audioCalibrating();
// Returns a completed quiet-room threshold once, for final_app to persist.
bool audioTakeQuietCalibration(uint8_t& noiseFloor);
// Process a finished DMA block and start the next one. A stalled capture becomes
// unavailable and reads silence, so an old loud reading cannot stick indefinitely.
void audioUpdate();
bool audioReady();
float audioLevel();
const AudioSample& audioLatest();

}  // namespace Firewalker
