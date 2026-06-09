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
  flashEnv_ = 0.0f;
  strip.setBrightness(LED_BRIGHTNESS);
}

void FlowPattern::update(const PatternInput& in) {
  if (!built_) buildPositions();

  // Stomp flash: jump to full, then ease back toward 0 so pixels settle to their
  // pooled value. Pooling keeps updating underneath during the fade.
  if (in.stomp) flashEnv_ = 1.0f;
  if (flashEnv_ > 0.0f) {
    flashEnv_ *= expf(-(float)in.dt / FLOW_STOMP_TAU_MS);
    if (flashEnv_ < 0.001f) flashEnv_ = 0.0f;
  }

  // Deadzone: ignore tiny tilts near level (mount offset / wobble) so the strip
  // rests flat, then rescale the remainder so full tilt still reaches full pooling.
  float tilt = in.tiltFwd;
  float at = fabsf(tilt);
  if (at <= FLOW_TILT_DEADZONE) {
    tilt = 0.0f;
  } else {
    float scaled = (at - FLOW_TILT_DEADZONE) / (1.0f - FLOW_TILT_DEADZONE);
    tilt = (tilt < 0.0f) ? -scaled : scaled;
  }

  // Pooling gradient: baseline magenta everywhere; tilt redistributes brightness
  // toward the down-end. At level (tilt=0) every pixel sits at the baseline.
  for (uint16_t i = 0; i < LED_COUNT; i++) {
    float b = FLOW_BASELINE + tilt * FLOW_GAIN * (pos_[i] - 0.5f);
    if (b < 0.0f) b = 0.0f;
    if (b > 1.0f) b = 1.0f;
    // Stomp lifts every pixel toward full, easing back to its pooled value.
    b += (FLOW_STOMP_LEVEL - b) * flashEnv_;
    if (b > 1.0f) b = 1.0f;
    strip.setPixelColor(i, strip.Color((uint8_t)(FLOW_COLOR_R * b),
                                        (uint8_t)(FLOW_COLOR_G * b),
                                        (uint8_t)(FLOW_COLOR_B * b)));
  }
  strip.show();
}

}  // namespace Firewalker
