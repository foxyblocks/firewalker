#include "patterns/fire_trail.h"

#include "firewalker_core.h"

namespace Firewalker {

// Fire gradient color at depth d behind the head (0 = white-hot head): linear
// interpolation across the FIRE[] palette stops, scaled to the band length.
static uint32_t fireColor(uint8_t d, uint8_t span) {
  if (span <= 1) return LedStrip::Color(FIRE[0][0], FIRE[0][1], FIRE[0][2]);

  uint16_t scaled = (uint16_t)d * ((FIRE_STOPS - 1) * 256) / (span - 1);
  uint8_t seg = scaled >> 8;
  uint8_t frac = scaled & 0xFF;
  if (seg >= FIRE_STOPS - 1) {
    seg = FIRE_STOPS - 2;
    frac = 255;
  }

  uint8_t r = FIRE[seg][0] + (int)(FIRE[seg + 1][0] - FIRE[seg][0]) * frac / 255;
  uint8_t g = FIRE[seg][1] + (int)(FIRE[seg + 1][1] - FIRE[seg][1]) * frac / 255;
  uint8_t b = FIRE[seg][2] + (int)(FIRE[seg + 1][2] - FIRE[seg][2]) * frac / 255;
  return LedStrip::Color(r, g, b);
}

void FireTrailPattern::buildGradient() {
  for (uint8_t d = 0; d < FIRE_TRAIL_LEN; d++) trailColor_[d] = fireColor(d, FIRE_TRAIL_LEN);
  built_ = true;
}

const __FlashStringHelper* FireTrailPattern::name() const { return F("fire-trail"); }

void FireTrailPattern::enter() {
  if (!built_) buildGradient();
  for (uint8_t i = 0; i < FIRE_TRAIL_MAX; i++) trails_[i].active = false;
  activeCount_ = 0;
  strip.clear();
  strip.show();
}

void FireTrailPattern::spawn() {
  for (uint8_t i = 0; i < FIRE_TRAIL_MAX; i++) {
    if (!trails_[i].active) {
      if (activeCount_ == 0) lastStepMs_ = millis();
      trails_[i].head = 0;
      trails_[i].active = true;
      activeCount_++;
      Serial.print(F("[firewalker] stomp -> trail ("));
      Serial.print(activeCount_);
      Serial.println(F(" active)"));
      return;
    }
  }
  Serial.println(F("[firewalker] stomp ignored - FIRE_TRAIL_MAX reached"));
}

void FireTrailPattern::render() {
  strip.clear();
  for (uint8_t i = 0; i < FIRE_TRAIL_MAX; i++) {
    if (!trails_[i].active) continue;
    for (uint8_t d = 0; d < FIRE_TRAIL_LEN; d++) {
      int16_t pos = trails_[i].head - d;
      if (pos >= 0 && pos < (int16_t)strip.numPixels()) {
        strip.setPixelColor(pos, trailColor_[d]);
      }
    }
  }
  strip.show();
}

// Steps by however many pixels are due, so trail speed stays FIRE_TRAIL_STEP_MS
// per pixel even when a frame takes longer than one step to send.
void FireTrailPattern::advanceIfDue() {
  if (activeCount_ == 0) return;

  const unsigned long now = millis();
  const unsigned long steps = (now - lastStepMs_) / FIRE_TRAIL_STEP_MS;
  if (steps == 0) return;

  lastStepMs_ += steps * FIRE_TRAIL_STEP_MS;
  for (uint8_t i = 0; i < FIRE_TRAIL_MAX; i++) {
    if (!trails_[i].active) continue;
    trails_[i].head += (int16_t)steps;
    int16_t bottom = trails_[i].head - (FIRE_TRAIL_LEN - 1);
    if (bottom >= (int16_t)strip.numPixels()) {
      trails_[i].active = false;
      activeCount_--;
    }
  }
  render();
}

void FireTrailPattern::update(const PatternInput& in) {
  if (in.stomp) {
    spawn();
    render();
  }
  advanceIfDue();
}

}  // namespace Firewalker
