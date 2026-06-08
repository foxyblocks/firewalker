#include "patterns/flow.h"

#include <Adafruit_NeoPixel.h>
#include <math.h>

#include "config.h"
#include "firewalker_core.h"

namespace Firewalker {

// Each pixel's fore-aft position s ∈ [0,1]. The strip loops heel→toe→heel, so
// the toe (FLOW_TOE_INDEX) is the apex (s=1) and both ends are the heel (s=0).
// A tent function over the index handles the two (possibly unequal) sides.
void FlowPattern::buildPositions() {
  for (uint16_t i = 0; i < LED_COUNT; i++) {
    float s;
    if (i <= FLOW_TOE_INDEX) {
      s = (FLOW_TOE_INDEX == 0) ? 1.0f : (float)i / (float)FLOW_TOE_INDEX;
    } else {
      uint16_t backspan = (LED_COUNT - 1) - FLOW_TOE_INDEX;
      s = (backspan == 0) ? 1.0f : (float)((LED_COUNT - 1) - i) / (float)backspan;
    }
    pos_[i] = s;
  }
  built_ = true;
}

const __FlashStringHelper* FlowPattern::name() const { return F("flow"); }

void FlowPattern::enter() {
  if (!built_) buildPositions();
  stompEnv_ = 1.0f;
  strip.setBrightness(LED_BRIGHTNESS);
}

void FlowPattern::update(const PatternInput& in) {
  if (!built_) buildPositions();

  // Stomp envelope: jump to the peak multiplier, then ease back to 1 (exponential
  // decay, snappy — ~3·tau settle). Pooling keeps updating underneath.
  if (in.stomp) stompEnv_ = FLOW_STOMP_PEAK;
  if (stompEnv_ > 1.0f) {
    stompEnv_ = 1.0f + (stompEnv_ - 1.0f) * expf(-(float)in.dt / FLOW_STOMP_TAU_MS);
    if (stompEnv_ < 1.001f) stompEnv_ = 1.0f;
  }

  // Pooling gradient: baseline magenta everywhere; tilt redistributes brightness
  // toward the down-end. At level (tilt=0) every pixel sits at the baseline.
  float tilt = in.tiltFwd;
  for (uint16_t i = 0; i < LED_COUNT; i++) {
    float b = FLOW_BASELINE + tilt * FLOW_GAIN * (pos_[i] - 0.5f);
    b *= stompEnv_;
    if (b < 0.0f) b = 0.0f;
    if (b > 1.0f) b = 1.0f;
    strip.setPixelColor(i, strip.Color((uint8_t)(FLOW_COLOR_R * b),
                                        (uint8_t)(FLOW_COLOR_G * b),
                                        (uint8_t)(FLOW_COLOR_B * b)));
  }
  strip.show();
}

}  // namespace Firewalker
