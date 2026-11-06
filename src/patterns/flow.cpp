#include "patterns/flow.h"

#include <math.h>

#include "config.h"
#include "firewalker_core.h"
#include "firewalker_strip_map.h"

namespace Firewalker {

// Each pixel's fore-aft position s ∈ [0,1] (heel=0, toe=1) from the ring map
// in firewalker_strip_map.h: the strip is a closed loop around the foot
// (pixel 0 under the controller, toe/heel at indices saved per boot), and the two
// arcs between toe and heel get linear ramps.
void FlowPattern::buildPositions() {
  layout_ = stripLayout();
  for (uint16_t i = 0; i < layout_.count; i++) {
    pos_[i] = stripForeAft(i, layout_.count, layout_.toe, layout_.heel);
  }
}

const __FlashStringHelper* FlowPattern::name() const { return F("flow"); }

void FlowPattern::enter() {
  buildPositions();
  // Start at red with no stomp effects left over from the previous run.
  hue_ = 0.0f;
  flashRemainMs_ = 0.0f;
  for (uint8_t k = 0; k < FLOW_MAX_FRONTS; k++) fronts_[k].active = false;
}

// Launch up to 4 diverging fronts from the tilt-derived fore-aft source: one
// source per arc of the ring (each handled in *unwrapped* indices, toe..toe+toeToHeel
// and heel..heel+heelToToe, so a front can cross the seam from the last pixel to
// pixel 0), and from each source one front toward the heel and one toward the toe.
// Unwrapped positions fold back to real pixels only when painting. Fronts with no room
// to travel (source already at an arc end) are skipped.
void FlowPattern::spawnTrail(float tilt, float strength) {
  float f = 0.5f + 0.5f * tilt;  // 0=heel, 0.5=mid-foot, 1=toe
  if (f < 0.0f) f = 0.0f;
  if (f > 1.0f) f = 1.0f;

  // Band brightness scales linearly with the stomp force: a threshold-force
  // step lights at FLOW_TRAIL_BRIGHT_MIN, a full-force stomp at 1.0.
  float bright = FLOW_TRAIL_BRIGHT_MIN + strength * (1.0f - FLOW_TRAIL_BRIGHT_MIN);

  const uint16_t toe = layout_.toe;
  const uint16_t heel = layout_.heel;
  const uint16_t toeToHeel = stripToeToHeelLen(layout_.count, toe, heel);
  const uint16_t heelToToe = stripHeelToToeLen(layout_.count, toe, heel);
  const uint16_t farHeel = toe + toeToHeel;  // the heel, unwrapped from the toe
  const uint16_t farToe = heel + heelToToe;  // the toe, unwrapped from the heel

  // Toe to heel: s falls as the index climbs, so the source sits f of the arc back
  // from the heel. Heel to toe: s climbs with the index.
  const float srcA = (float)farHeel - f * (float)toeToHeel;
  const float srcB = (float)heel + f * (float)heelToToe;

  const float    heads[4] = {srcA, srcA, srcB, srcB};
  const int8_t   dirs[4]  = {-1, +1, -1, +1};
  const uint16_t los[4]   = {toe, toe, heel, heel};
  const uint16_t his[4]   = {farHeel, farHeel, farToe, farToe};

  for (uint8_t i = 0; i < 4; i++) {
    bool room = (dirs[i] > 0) ? (heads[i] < (float)his[i] - 0.5f)
                              : (heads[i] > (float)los[i] + 0.5f);
    if (!room) continue;
    for (uint8_t k = 0; k < FLOW_MAX_FRONTS; k++) {
      if (!fronts_[k].active) {
        fronts_[k] = {heads[i], dirs[i], los[i], his[i], true, bright};
        break;
      }
    }
  }
}

// Trail band color at depth d behind the head (0 = white head). White → current
// hue (full) → the previous hue in the rotation. `bright` (0..1) scales the
// band's value so harder stomps paint brighter trails.
static uint32_t bandColor(uint8_t d, uint16_t hue, float bright) {
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
  return LedStrip::ColorHSV(h, s, (uint8_t)(bright * 255.0f));
}

// Blend a packed RGB color toward white by amt (0 = unchanged, 1 = full white).
static uint32_t whiten(uint32_t c, float amt) {
  uint8_t r = (uint8_t)(c >> 16), g = (uint8_t)(c >> 8), b = (uint8_t)c;
  r = (uint8_t)(r + (255 - r) * amt);
  g = (uint8_t)(g + (255 - g) * amt);
  b = (uint8_t)(b + (255 - b) * amt);
  return LedStrip::Color(r, g, b);
}

void FlowPattern::update(const PatternInput& in) {
  // Advance the shared hue (one full spectrum loop over FLOW_HUE_CYCLE_MS).
  hue_ += 65536.0f * (float)in.dt / (float)FLOW_HUE_CYCLE_MS;
  while (hue_ >= 65536.0f) hue_ -= 65536.0f;
  uint16_t hueU = (uint16_t)hue_;

  // The motion service reports exactly 0 inside its dead zone, so that's what level means.
  const float tilt = in.tiltFwd;

  // A tilted stomp pours directional trails from the down-point; a flat stomp
  // has no down direction, so it flashes the whole strip white instead.
  if (in.stomp) {
    if (tilt == 0.0f) flashRemainMs_ = (float)FLOW_FLASH_MS;
    else spawnTrail(tilt, in.stompStrength);
  }

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

  // Fill-gauge background: one rotating hue. The lit band is a fill level from
  // the down-end — `at` (0..1) is both the fill edge in fore-aft units and how
  // far each survivor brightens toward full. Each pixel's litFrac fades across
  // a one-pixel span (pxW) as the edge sweeps past, so pixels extinguish
  // one-by-one from the up-end. At level (at 0) every pixel is lit at baseline.
  // With uneven arcs, pxW comes from the longer one, whose pixels sit closest
  // together, so a single pixel still remains at full tilt.
  const float at = fabsf(tilt);                      // magnitude / fill edge
  const bool  toeDown   = (tilt >= 0.0f);
  const uint16_t toeToHeel = stripToeToHeelLen(layout_.count, layout_.toe, layout_.heel);
  const uint16_t heelToToe = stripHeelToToeLen(layout_.count, layout_.toe, layout_.heel);
  const float pxW       = 1.0f / (float)((toeToHeel > heelToToe) ? toeToHeel : heelToToe);
  const float litBright = FLOW_BASELINE + at * (1.0f - FLOW_BASELINE);  // survivors → full
  float flash = (flashRemainMs_ > 0.0f) ? flashRemainMs_ / (float)FLOW_FLASH_MS : 0.0f;
  if (flash > 1.0f) flash = 1.0f;
  for (uint16_t i = 0; i < layout_.count; i++) {
    // litFrac: 1 well inside the lit band, ramping to 0 one pixel past the edge.
    float litFrac = toeDown ? (pos_[i] - at) / pxW + 1.0f
                            : (1.0f - at - pos_[i]) / pxW + 1.0f;
    if (litFrac < 0.0f) litFrac = 0.0f;
    if (litFrac > 1.0f) litFrac = 1.0f;
    float b = litFrac * litBright;
    uint32_t c = LedStrip::ColorHSV(hueU, 255, (uint8_t)(b * 255.0f));
    if (flash > 0.0f) c = whiten(c, flash);
    strip.setPixelColor(i, c);
  }
  if (flashRemainMs_ > 0.0f) {
    flashRemainMs_ -= (float)in.dt;
    if (flashRemainMs_ < 0.0f) flashRemainMs_ = 0.0f;
  }

  // Stomp trails overlay the background, each clamped to its arc; unwrapped
  // positions (past the last index) fold back to real pixels here.
  for (uint8_t k = 0; k < FLOW_MAX_FRONTS; k++) {
    if (!fronts_[k].active) continue;
    for (uint8_t d = 0; d < FLOW_TRAIL_LEN; d++) {
      int16_t p = (int16_t)lroundf(fronts_[k].head - (float)fronts_[k].dir * (float)d);
      if (p < (int16_t)fronts_[k].lo || p > (int16_t)fronts_[k].hi) continue;
      strip.setPixelColor(stripWrapIndex((uint16_t)p, layout_.count), bandColor(d, hueU, fronts_[k].bright));
    }
  }

  strip.show();
}

}  // namespace Firewalker
