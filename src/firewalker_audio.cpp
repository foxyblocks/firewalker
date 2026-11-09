// Timed capture for the MG24 Sense microphone. The IADC's own timer chooses each
// sample instant and DMA writes a complete block without CPU polling. The DMA
// interrupt pauses that timer and marks the block ready. audioUpdate() measures
// and smooths it on the main loop, then starts another block. This keeps work out
// of the interrupt and leaves the radio and hardware-timed LED output responsive.
#include "firewalker_audio.h"

#include <Arduino.h>
#include "dmadrv.h"
#include "em_cmu.h"
#include "em_gpio.h"
#include "em_iadc.h"
#include "config.h"
#include "firewalker_settings.h"

namespace Firewalker {
namespace {
uint32_t samples[AUDIO_BLOCK_SAMPLES];
unsigned int dmaChannel;
bool ready = false;
volatile bool blockReady = false;
volatile uint32_t completedUs = 0;
uint32_t captureStartUs = 0;
uint32_t lastProcessedMs = 0;
AudioSample latest{};
float noiseRms = AUDIO_DEFAULT_NOISE_FLOOR;
float fullRms = audioFullRms(noiseRms, AUDIO_DEFAULT_SENSITIVITY);
float quietSamples[AUDIO_CALIBRATION_SAMPLES];
size_t quietCount = 0;
uint32_t quietStartedMs = 0;
bool calibrating = false;
bool calibrationDone = false;
AudioGate gate;
float gateMultiplier = AUDIO_GATE_OPEN_MULTIPLIER;
uint8_t calibratedFloor = AUDIO_DEFAULT_NOISE_FLOOR;

bool sampled(unsigned int, unsigned int, void*) {
  IADC_command(IADC0, iadcCmdDisableTimer);
  completedUs = micros();
  blockReady = true;
  return false;
}

bool startBlock() {
  // Drain any last conversion that completed after the timer was disabled.
  while (IADC_getScanFifoCnt(IADC0)) IADC_pullScanFifoResult(IADC0);
  blockReady = false;
  const Ecode_t result = DMADRV_PeripheralMemory(dmaChannel,
      dmadrvPeripheralSignal_IADC0_IADC_SCAN, samples, (void*)&IADC0->SCANFIFODATA,
      true, AUDIO_BLOCK_SAMPLES, dmadrvDataSize4, sampled, nullptr);
  if (result != ECODE_EMDRV_DMADRV_OK) return false;
  captureStartUs = micros();
  IADC_command(IADC0, iadcCmdStartScan);
  IADC_command(IADC0, iadcCmdEnableTimer);
  return true;
}

void stopCapture() {
  IADC_command(IADC0, iadcCmdDisableTimer);
  IADC_command(IADC0, iadcCmdStopScan);
  DMADRV_StopTransfer(dmaChannel);
  DMADRV_FreeChannel(dmaChannel);
  ready = false;
  calibrating = false;
  latest.level = 0.0f;
  digitalWrite(AUDIO_POWER_PIN, LOW);
}
}  // namespace

void audioConfigure(uint8_t noiseFloor, uint8_t sensitivity) {
  noiseRms = noiseFloor;
  fullRms = audioFullRms(noiseRms, sensitivity);
  // Keep the calibrated quiet floor fixed, while higher sensitivity also lets
  // quieter sustained sounds open the gate. At 100 only the room floor remains.
  gateMultiplier = 1.0f + (AUDIO_GATE_OPEN_MULTIPLIER - 1.0f) *
      (100.0f - sensitivity) / (100.0f - AUDIO_DEFAULT_SENSITIVITY);
  latest.level = 0.0f;
  gate = AudioGate{};
}

bool audioStartQuietCalibration() {
  if (!ready || calibrating) return false;
  quietCount = 0;
  quietStartedMs = millis();
  calibrationDone = false;
  calibrating = true;
  return true;
}

bool audioCalibrating() { return calibrating; }

bool audioTakeQuietCalibration(uint8_t& noiseFloor) {
  if (!calibrationDone) return false;
  calibrationDone = false;
  noiseFloor = calibratedFloor;
  return true;
}

bool audioBegin() {
  if (ready) return true;
  pinMode(AUDIO_POWER_PIN, OUTPUT);
  digitalWrite(AUDIO_POWER_PIN, HIGH);
  delay(AUDIO_STARTUP_MS);
  CMU_ClockEnable(cmuClock_GPIO, true);
  CMU_ClockEnable(cmuClock_IADC0, true);
  CMU_ClockSelectSet(cmuClock_IADCCLK, cmuSelect_FSRCO);
  GPIO_PinModeSet(AUDIO_DATA_PORT, AUDIO_DATA_PIN, gpioModeDisabled, 0);
  GPIO->CDBUSALLOC |= GPIO_CDBUSALLOC_CDODD0_ADC0;

  IADC_reset(IADC0);
  IADC_Init_t init = IADC_INIT_DEFAULT;
  init.warmup = iadcWarmupKeepWarm;
  init.srcClkPrescale = IADC_calcSrcClkPrescale(IADC0, AUDIO_ADC_SOURCE_HZ, 0);
  const uint32_t sourceHz = CMU_ClockFreqGet(cmuClock_IADC0) / (init.srcClkPrescale + 1);
  init.timerCycles = sourceHz / AUDIO_SAMPLE_HZ - 1;
  IADC_AllConfigs_t configs = IADC_ALLCONFIGS_DEFAULT;
  configs.configs[0].reference = iadcCfgReferenceVddx;
  configs.configs[0].vRef = AUDIO_REFERENCE_MV;
  configs.configs[0].adcClkPrescale = IADC_calcAdcClkPrescale(IADC0,
      AUDIO_ADC_CLOCK_HZ, 0, iadcCfgModeNormal, init.srcClkPrescale);
  IADC_init(IADC0, &init, &configs);

  IADC_InitScan_t scan = IADC_INITSCAN_DEFAULT;
  scan.triggerSelect = iadcTriggerSelTimer;
  scan.triggerAction = iadcTriggerActionOnce;
  scan.dataValidLevel = iadcFifoCfgDvl1;
  scan.fifoDmaWakeup = true;
  IADC_ScanTable_t table = IADC_SCANTABLE_DEFAULT;
  table.entries[0].posInput = AUDIO_ADC_INPUT;
  table.entries[0].includeInScan = true;
  IADC_initScan(IADC0, &scan, &table);

  DMADRV_Init();
  if (DMADRV_AllocateChannel(&dmaChannel, nullptr) != ECODE_EMDRV_DMADRV_OK) {
    Serial.println(F("[audio] DMA channel unavailable"));
    return false;
  }
  lastProcessedMs = millis();
  ready = true;
  if (!startBlock()) {
    stopCapture();
    Serial.println(F("[audio] DMA capture failed to start"));
    return false;
  }
  Serial.println(F("[audio] microphone capture started"));
  return true;
}

void audioUpdate() {
  if (!ready) return;
  const uint32_t now = millis();
  if (!blockReady) {
    if (now - lastProcessedMs >= AUDIO_STALE_MS) {
      stopCapture();
      Serial.println(F("[audio] capture stalled"));
    }
    return;
  }
  latest.block = measureAudioBlock(samples, AUDIO_BLOCK_SAMPLES);
  audioWaveform(samples, AUDIO_BLOCK_SAMPLES, latest.block.mean,
                latest.waveform, AUDIO_WAVEFORM_SIZE, fullRms * 1.41421356f);
  const bool gateOpen = audioGateStep(gate, latest.block.rms, noiseRms,
      gateMultiplier, AUDIO_GATE_OPEN_BLOCKS);
  const float target = gateOpen ? audioLevelFromRms(latest.block.rms, noiseRms, fullRms) : 0.0f;
  latest.level = smoothAudioLevel(latest.level, target, now - lastProcessedMs,
      AUDIO_ATTACK_MS, AUDIO_RELEASE_MS);
  // The 90th percentile ignores a short click or tap while retaining ordinary
  // background noise. Leave extra headroom so quiet-room jitter stays dark.
  if (calibrating) {
    if (quietCount < AUDIO_CALIBRATION_SAMPLES) quietSamples[quietCount++] = latest.block.rms;
    if (now - quietStartedMs >= AUDIO_CALIBRATION_MS && quietCount >= 20) {
      calibratedFloor = quietAudioNoiseFloor(quietSamples, quietCount);
      calibrating = false;
      calibrationDone = true;
    }
  }
  if (latest.level < 0.002f) latest.level = 0.0f;
  latest.blocks++;
  latest.captureUs = completedUs - captureStartUs;
  lastProcessedMs = now;
  if (!startBlock()) {
    stopCapture();
    Serial.println(F("[audio] DMA capture failed to restart"));
  }
}

bool audioReady() { return ready; }
float audioLevel() { return latest.level; }
const AudioSample& audioLatest() { return latest; }
}  // namespace Firewalker
