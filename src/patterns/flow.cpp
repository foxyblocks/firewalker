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
  for (uint8_t k = 0; k < FLOW_MAX_FRONTS; k++) fronts_[k].active = false;
  strip.setBrightness(LED_BRIGHTNESS);
}

// Launch up to 4 diverging fronts from the tilt-derived fore-aft source. The
// source fraction f maps to a pixel on each side (side A: heel..toe, side B:
// toe..heel); from each, one front heads toward the heel end and one toward the
// toe. Fronts with no room to travel (source already at an end) are skipped.
void FlowPattern::spawnTrail(float tilt) {
  float f = 0.5f + 0.5f * tilt;  // 0=heel, 0.5=mid-foot, 1=toe
  if (f < 0.0f) f = 0.0f;
  if (f > 1.0f) f = 1.0f;

  const uint16_t end  = LED_COUNT - 1;
  const float    srcA = f * (float)FLOW_TOE_INDEX;
  const float    srcB = (float)FLOW_TOE_INDEX + (1.0f - f) * (float)(end - FLOW_TOE_INDEX);

  const float    heads[4] = {srcA, srcA, srcB, srcB};
  const int8_t   dirs[4]  = {-1, +1, -1, +1};
  const uint16_t los[4]   = {0, 0, FLOW_TOE_INDEX, FLOW_TOE_INDEX};
  const uint16_t his[4]   = {FLOW_TOE_INDEX, FLOW_TOE_INDEX, end, end};

  for (uint8_t i = 0; i < 4; i++) {
    bool room = (dirs[i] > 0) ? (heads[i] < (float)his[i] - 0.5f)
                              : (heads[i] > (float)los[i] + 0.5f);
    if (!room) continue;
    for (uint8_t k = 0; k < FLOW_MAX_FRONTS; k++) {
      if (!fronts_[k].active) {
        fronts_[k] = {heads[i], dirs[i], los[i], his[i], true};
        break;
      }
    }
  }
}

// Trail band color at depth d behind the head (0 = white head). White → current
// hue (full) → the previous hue in the rotation.
static uint32_t bandColor(uint8_t d, uint16_t hue) {
  float t = (FLOW_TRAIL_LEN <= 1) ? 0.0f : (float)d / (float)(FLOW_TRAIL_LEN - 1);
  uint16_t h;
  uint8_t  s;
  if (t <= 0.5f) {  // white head saturating into the current hue
    h = hue;
    s = (uint8_t)((t / 0.5f) * 255.0f);
  } else {          // current hue easing back to the previous hue
    float seg = (t - 0.5f) / 0.5f;
    h = (uint16_t)(hue - (uint16_t)(seg * (float)FLOW_TRAIL_PREV_HUE));
    s = 255;
  }
  return Adafruit_NeoPixel::ColorHSV(h, s, 255);
}

void FlowPattern::update(const PatternInput& in) {
  if (!built_) buildPositions();

  // Advance the shared hue (one full spectrum loop over FLOW_HUE_CYCLE_MS).
  hue_ += 65536.0f * (float)in.dt / (float)FLOW_HUE_CYCLE_MS;
  while (hue_ >= 65536.0f) hue_ -= 65536.0f;
  uint16_t hueU = (uint16_t)hue_;

  // Deadzone + rescale: rest flat near level; a firm tilt reaches full pooling.
  float tilt = in.tiltFwd;
  float at = fabsf(tilt);
  if (at <= FLOW_TILT_DEADZONE) {
    tilt = 0.0f;
  } else {
    float scaled = (at - FLOW_TILT_DEADZONE) / (1.0f - FLOW_TILT_DEADZONE);
    tilt = (tilt < 0.0f) ? -scaled : scaled;
  }

  if (in.stomp) spawnTrail(tilt);

  // Advance fronts; retire any whose band has fully cleared its side.
  float step = FLOW_TRAIL_SPEED_PXPS * (float)in.dt / 1000.0f;
  for (uint8_t k = 0; k < FLOW_MAX_FRONTS; k++) {
    if (!fronts_[k].active) continue;
    fronts_[k].head += (float)fronts_[k].dir * step;
    if (fronts_[k].dir > 0 && fronts_[k].head > (float)fronts_[k].hi + FLOW_TRAIL_LEN)
      fronts_[k].active = false;
    if (fronts_[k].dir < 0 && fronts_[k].head < (float)fronts_[k].lo - FLOW_TRAIL_LEN)
      fronts_[k].active = false;
  }

  // Pooling background: one rotating hue, brightness pooled toward the down-end.
  for (uint16_t i = 0; i < LED_COUNT; i++) {
    float b = FLOW_BASELINE + tilt * FLOW_GAIN * (pos_[i] - 0.5f);
    if (b < 0.0f) b = 0.0f;
    if (b > 1.0f) b = 1.0f;
    strip.setPixelColor(i, Adafruit_NeoPixel::ColorHSV(hueU, 255, (uint8_t)(b * 255.0f)));
  }

  // Stomp trails overlay the background, each clamped to its side of the loop.
  for (uint8_t k = 0; k < FLOW_MAX_FRONTS; k++) {
    if (!fronts_[k].active) continue;
    for (uint8_t d = 0; d < FLOW_TRAIL_LEN; d++) {
      int16_t p = (int16_t)lroundf(fronts_[k].head - (float)fronts_[k].dir * (float)d);
      if (p < (int16_t)fronts_[k].lo || p > (int16_t)fronts_[k].hi) continue;
      if (p < 0 || p >= (int16_t)LED_COUNT) continue;
      strip.setPixelColor(p, bandColor(d, hueU));
    }
  }

  strip.show();
}

}  // namespace Firewalker
