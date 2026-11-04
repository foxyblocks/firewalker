#include "patterns/fire_trail.h"

#include "firewalker_core.h"

// fire-trail draws each stomp's route from firewalker_trail_path.h as bands of fire. This
// file owns the timing, the colors, and the slots that let trails stack. See
// include/patterns/fire_trail.h for what it looks like.

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

static const __FlashStringHelper* originName(TrailOrigin origin) {
  switch (origin) {
    case TrailOrigin::Toe: return F("toe");
    case TrailOrigin::Heel: return F("heel");
    case TrailOrigin::Middle: break;
  }
  return F("middle");
}

// Starts a trail from whichever part of the boot is down at this stomp. Later tilt doesn't
// affect it, so trails from different stomps can run in different directions at once. The
// log line shows the angle behind each choice, for tuning FIRE_TRAIL_FLAT_DEG on a real foot.
void FireTrailPattern::spawn(float tiltDeg) {
  for (uint8_t i = 0; i < FIRE_TRAIL_MAX; i++) {
    if (!trails_[i].active) {
      if (activeCount_ == 0) pixelsDue_ = 0.0f;
      const TrailOrigin origin = trailOriginFromTilt(tiltDeg, FIRE_TRAIL_FLAT_DEG);
      trails_[i].path = trailPath(stripLayout(), origin);
      trails_[i].head = 0;
      trails_[i].active = true;
      activeCount_++;
      Serial.print(F("[firewalker] stomp -> trail from "));
      Serial.print(originName(origin));
      Serial.print(F(" ("));
      Serial.print(tiltDeg, 1);
      Serial.print(F(" deg, "));
      Serial.print(activeCount_);
      Serial.println(F(" active)"));
      return;
    }
  }
  Serial.println(F("[firewalker] stomp ignored - FIRE_TRAIL_MAX reached"));
}

// Each pixel of a band sits d steps behind its head. Anything before the route's start
// hasn't emerged yet, and anything past its far end has already gone, which is what wipes a
// band in at the origin and out at the far end.
void FireTrailPattern::render() {
  const uint16_t count = strip.numPixels();
  strip.clear();
  for (uint8_t i = 0; i < FIRE_TRAIL_MAX; i++) {
    if (!trails_[i].active) continue;
    const TrailPath& path = trails_[i].path;
    for (uint8_t f = 0; f < path.frontCount; f++) {
      const TrailFront& front = path.fronts[f];
      for (uint8_t d = 0; d < FIRE_TRAIL_LEN; d++) {
        const int16_t steps = trails_[i].head - d;
        if (steps >= 0 && steps <= (int16_t)front.length) {
          strip.setPixelColor(trailFrontPixel(front, (uint16_t)steps, count), trailColor_[d]);
        }
      }
    }
  }
  strip.show();
}

// Steps by however many whole pixels are due and carries the fraction to the next frame, so
// trails hold FIRE_TRAIL_SPEED_PXPS at any speed or frame rate. Example: at 200 pixels per
// second, a 16 ms frame is due 3.2 pixels, so it steps 3 and carries 0.2.
void FireTrailPattern::advanceIfDue(unsigned long dt) {
  if (activeCount_ == 0) return;

  pixelsDue_ += FIRE_TRAIL_SPEED_PXPS * (float)dt / 1000.0f;
  const int16_t steps = (int16_t)pixelsDue_;
  if (steps == 0) return;

  pixelsDue_ -= (float)steps;
  for (uint8_t i = 0; i < FIRE_TRAIL_MAX; i++) {
    if (!trails_[i].active) continue;
    trails_[i].head += steps;
    // Done once the tail has passed the far end of the longest route.
    const int16_t tailSteps = trails_[i].head - (FIRE_TRAIL_LEN - 1);
    if (tailSteps > (int16_t)trails_[i].path.longest) {
      trails_[i].active = false;
      activeCount_--;
    }
  }
  render();
}

void FireTrailPattern::update(const PatternInput& in) {
  if (in.stomp) {
    spawn(in.tiltDeg);
    render();
  }
  advanceIfDue(in.dt);
}

}  // namespace Firewalker
