#pragma once

// Runs a decoded recipe: each frame it takes the fused tilt, whether a stomp fired, and the elapsed
// time, and draws every layer into one frame of colors. This is a port of the designer's
// designer/src/engine/engine.ts, which is the reference. test/test_recipe_engine checks that this
// draws the same pixels, using frames saved from that engine. A change to what either one draws
// goes into both, with new frames from `bun run reference-frames`.
//
// Pure and Arduino-free. src/patterns/recipe_pattern.cpp is what connects it to the strip.
// Everything lives inside the object, sized for MaxPixels, and nothing allocates, so it needs static
// storage. There's one engine on a boot, because only one pattern runs at a time.
//
// Two things keep it matching a JavaScript engine that does all its math in doubles:
//
// - Anything that builds up from frame to frame is a double, along with the knob values that feed
//   it. Small float errors there would grow until a comet landed on a different pixel. Colors are
//   floats, since this chip's math hardware only does floats, and a tiny error there can't show in
//   8-bit color.
// - Rounding is floor(x + 0.5), which is JavaScript's Math.round. C's round differs on negative
//   halves, and positions along the strip can be negative here.

#include <math.h>
#include <stdint.h>
#include <string.h>

#include "firewalker_recipe.h"
#include "firewalker_strip_map.h"

namespace Firewalker {

constexpr uint8_t RECIPE_MAX_FRONTS = 16;
constexpr uint32_t RECIPE_RNG_SEED = 0x9E3779B9u;
// A long stall counts as this much time, so one frame can't do unbounded work.
constexpr uint32_t RECIPE_MAX_DT_MS = 250;

inline double recipeClamp01(double x) { return x < 0.0 ? 0.0 : x > 1.0 ? 1.0 : x; }

inline int32_t recipeRound(double x) { return (int32_t)floor(x + 0.5); }

inline double recipeWrap(double p, double count) { return fmod(fmod(p, count) + count, count); }

inline int32_t recipeWrapIndex(int32_t p, int32_t count) { return ((p % count) + count) % count; }

template <uint16_t MaxPixels>
class RecipeEngine {
 public:
  // Points the engine at a recipe and starts it fresh. `recipe` has to stay in place while it runs.
  void start(const Recipe* recipe, const StripLayout& layout) {
    recipe_ = recipe;
    layout_ = layout;
    toeToHeel_ = stripToeToHeelLen(layout.count, layout.toe, layout.heel);
    heelToToe_ = stripHeelToToeLen(layout.count, layout.toe, layout.heel);
    for (uint16_t i = 0; i < layout.count; i++) {
      positions_[i] = stripForeAft(i, layout.count, layout.toe, layout.heel);
    }
    enter();
  }

  // Starts the pattern over, as when a boot switches to it.
  void enter() {
    timeMs_ = 0;
    tilt_ = 0.0;
    lastStrength_ = 0.0;
    sinceStompMs_ = 0;
    stompSeen_ = false;
    rng_ = RECIPE_RNG_SEED;
    memset(states_, 0, sizeof(states_));
    for (uint8_t l = 0; l < RECIPE_MAX_LAYERS; l++) states_[l].dir = 1;
    memset(frame_, 0, sizeof(frame_));
  }

  // Advances one frame. `dtMs` is the time since the previous one, and `stompStrength` only counts
  // when `stomp` is true. Read the result with frameByte().
  void update(float tiltFwd, bool stomp, float stompStrength, uint32_t dtMs) {
    if (!recipe_) return;
    const uint32_t dt = dtMs > RECIPE_MAX_DT_MS ? RECIPE_MAX_DT_MS : dtMs;
    timeMs_ += dt;
    if (stompSeen_ && sinceStompMs_ < 0xFFFF0000u) sinceStompMs_ += dt;
    tilt_ = fmax(-1.0, fmin(1.0, (double)tiltFwd));
    if (stomp) {
      lastStrength_ = recipeClamp01((double)stompStrength);
      sinceStompMs_ = 0;
      stompSeen_ = true;
    }

    memset(frame_, 0, sizeof(float) * 3 * layout_.count);
    for (uint8_t l = 0; l < recipe_->layerCount; l++) {
      const RecipeLayer& layer = recipe_->layers[l];
      memset(layerAlpha_, 0, sizeof(float) * layout_.count);
      drawLayer(layer, states_[l], stomp, dt);
      composite(layer);
    }
  }

  uint16_t pixelCount() const { return layout_.count; }

  // One channel of one pixel as the 0 to 255 value a boot stores, before its brightness setting.
  uint8_t frameByte(uint16_t pixel, uint8_t channel) const {
    const float value = frame_[pixel * 3 + channel];
    const float limited = value < 0.0f ? 0.0f : value > 1.0f ? 1.0f : value;
    return (uint8_t)floorf(limited * 255.0f + 0.5f);
  }

 private:
  struct Front {
    double head;
    double speed;
    int32_t lo;
    int32_t hi;
    float bright;
    int8_t dir;
    bool active;
  };

  // What a layer remembers between frames. A layer only uses the parts for its type, and only a
  // trail or a sparkle needs the large arrays, so those two share the space.
  struct LayerState {
    double phase;      // fill: how far the palette has scrolled, from 0 to 1
    double position;   // chase: the first comet's head on the ring
    double progress;   // chase: the first comet's head along the foot
    double pending;    // sparkle: the part of a new sparkle still owed
    double flashBright;
    uint32_t flashRemainMs;
    int8_t dir;  // chase: which way it last moved, which sets where the tail points
    union {
      Front fronts[RECIPE_MAX_FRONTS];
      struct {
        float level[MaxPixels];
        float hue[MaxPixels];
      } sparkle;
    };
  };

  struct Spawn {
    double head;
    int32_t lo;
    int32_t hi;
    int8_t dir;
  };

  static uint8_t choiceOf(const RecipeLayer& layer, uint8_t slot) { return layer.choices[slot]; }

  double sourceValue(const RecipeKnob& knob) const {
    switch (knob.source) {
      case RecipeSource::Tilt:
        return (tilt_ + 1.0) / 2.0;
      case RecipeSource::TiltAmount:
        return fabs(tilt_);
      case RecipeSource::StompStrength:
        return lastStrength_;
      case RecipeSource::StompFade:
        if (!stompSeen_ || sinceStompMs_ >= knob.ms) return 0.0;
        return 1.0 - (double)sinceStompMs_ / (double)knob.ms;
      case RecipeSource::Wave:
        return 0.5 - 0.5 * cos((2.0 * M_PI * (double)(timeMs_ % knob.ms)) / (double)knob.ms);
    }
    return 0.0;
  }

  double knobValue(const RecipeKnob& knob) const {
    if (!knob.bound) return (double)knob.min;
    return (double)knob.min + ((double)knob.max - (double)knob.min) * sourceValue(knob);
  }

  // Writes the palette's color at u to out. A looping palette blends its last color back into its
  // first, so u and u + 1 match. Otherwise the first color is at 0, the last at 1, and u is limited.
  static void samplePalette(const RecipeLayer& layer, float u, bool loop, float* out) {
    const uint8_t n = layer.paletteCount;
    if (n == 1) {
      memcpy(out, layer.palette[0], sizeof(float) * 3);
      return;
    }
    uint8_t a;
    uint8_t b;
    float f;
    if (loop) {
      const float x = (u - floorf(u)) * (float)n;
      a = (uint8_t)((int32_t)floorf(x) % n);
      b = (uint8_t)((a + 1) % n);
      f = x - floorf(x);
    } else {
      const float x = fminf(1.0f, fmaxf(0.0f, u)) * (float)(n - 1);
      const int32_t whole = (int32_t)floorf(x);
      a = (uint8_t)(whole < n - 2 ? whole : n - 2);
      b = (uint8_t)(a + 1);
      f = x - (float)a;
    }
    for (uint8_t c = 0; c < 3; c++) {
      out[c] = layer.palette[a][c] + (layer.palette[b][c] - layer.palette[a][c]) * f;
    }
  }

  // Sets one pixel of the current layer to the palette color at u, scaled by bright.
  void paint(const RecipeLayer& layer, int32_t pixel, float u, bool loop, float bright, float alpha) {
    float color[3];
    samplePalette(layer, u, loop, color);
    setPixel(pixel, color, bright, alpha);
  }

  void setPixel(int32_t pixel, const float* color, float bright, float alpha) {
    const int32_t at = pixel * 3;
    layerColor_[at] = color[0] * bright;
    layerColor_[at + 1] = color[1] * bright;
    layerColor_[at + 2] = color[2] * bright;
    layerAlpha_[pixel] = alpha;
  }

  bool triggerMatches(RecipeTrigger trigger) const {
    if (trigger == RecipeTrigger::Flat) return tilt_ == 0.0;
    if (trigger == RecipeTrigger::Tilted) return tilt_ != 0.0;
    return true;
  }

  void drawLayer(const RecipeLayer& layer, LayerState& state, bool stomp, uint32_t dt) {
    switch (layer.type) {
      case RecipeLayerType::Fill:
        drawFill(layer, state, dt);
        return;
      case RecipeLayerType::Pool:
        drawPool(layer);
        return;
      case RecipeLayerType::Trail: {
        const RecipeTrigger trigger = (RecipeTrigger)choiceOf(layer, RecipeSlot::TrailTrigger);
        drawTrail(layer, state, stomp && triggerMatches(trigger), dt);
        return;
      }
      case RecipeLayerType::Flash: {
        const RecipeTrigger trigger = (RecipeTrigger)choiceOf(layer, RecipeSlot::FlashTrigger);
        drawFlash(layer, state, stomp && triggerMatches(trigger), dt);
        return;
      }
      case RecipeLayerType::Sparkle:
        drawSparkle(layer, state, dt);
        return;
      case RecipeLayerType::Chase:
        drawChase(layer, state, dt);
        return;
    }
  }

  void drawFill(const RecipeLayer& layer, LayerState& state, uint32_t dt) {
    state.phase += (knobValue(layer.knobs[RecipeSlot::FillScroll]) * (double)dt) / 1000.0;
    state.phase -= floor(state.phase);
    const float base = (float)(knobValue(layer.knobs[RecipeSlot::FillOffset]) + state.phase);
    const float repeat = (float)knobValue(layer.knobs[RecipeSlot::FillRepeat]);
    const float bright = (float)recipeClamp01(knobValue(layer.knobs[RecipeSlot::FillBrightness]));
    const RecipeSpread spread = (RecipeSpread)choiceOf(layer, RecipeSlot::FillSpread);
    const uint16_t count = layout_.count;
    for (uint16_t i = 0; i < count; i++) {
      float along = 0.0f;
      if (spread == RecipeSpread::Ring) along = (float)i / (float)count;
      if (spread == RecipeSpread::Foot) along = positions_[i];
      paint(layer, i, base + along * repeat, true, bright, 1.0f);
    }
  }

  // Flow's fill gauge. `at` is both how far the fill edge has moved and how far the survivors
  // brighten toward full, and each pixel fades across a one-pixel span as the edge passes. With
  // uneven arcs the span comes from the longer one, so one pixel still survives at full tilt.
  void drawPool(const RecipeLayer& layer) {
    const float baseline = (float)recipeClamp01(knobValue(layer.knobs[RecipeSlot::PoolBaseline]));
    const float at = (float)fabs(tilt_);
    const bool toeDown = tilt_ >= 0.0;
    const float span = 1.0f / (float)(toeToHeel_ > heelToToe_ ? toeToHeel_ : heelToToe_);
    const float litBright = baseline + at * (1.0f - baseline);
    for (uint16_t i = 0; i < layout_.count; i++) {
      const float s = positions_[i];
      const float edge = (toeDown ? (s - at) : (1.0f - at - s)) / span + 1.0f;
      const float lit = edge < 0.0f ? 0.0f : edge > 1.0f ? 1.0f : edge;
      const float b = lit * litBright;
      layerColor_[i * 3] = layerColor_[i * 3 + 1] = layerColor_[i * 3 + 2] = b;
      layerAlpha_[i] = 1.0f;
    }
  }

  // Where a stomp's fronts start: one source on each arc, f of the way from heel to toe, and a front
  // each way along both, skipping any with no room to move. Down point is flow's, with f following
  // the tilt. Down end is fire-trail's, with f snapped to the heel, the middle, or the toe. Movement
  // uses unwrapped positions, such as heel..heel+heelToToe, folded back to real pixels when painting.
  uint8_t trailSpawns(RecipeTrailOrigin from, float flatZone, Spawn* out) const {
    double f;
    if (from == RecipeTrailOrigin::DownEnd) {
      const double zone = (double)flatZone;
      f = tilt_ > zone ? 1.0 : tilt_ < -zone ? 0.0 : 0.5;
    } else {
      f = recipeClamp01(0.5 + 0.5 * tilt_);
    }
    const int32_t toe = layout_.toe;
    const int32_t heel = layout_.heel;
    const int32_t farHeel = toe + toeToHeel_;
    const int32_t farToe = heel + heelToToe_;
    const double srcA = (double)farHeel - f * (double)toeToHeel_;
    const double srcB = (double)heel + f * (double)heelToToe_;
    const Spawn candidates[4] = {
        {srcA, toe, farHeel, -1},
        {srcA, toe, farHeel, 1},
        {srcB, heel, farToe, -1},
        {srcB, heel, farToe, 1},
    };
    uint8_t count = 0;
    for (const Spawn& c : candidates) {
      const bool hasRoom = c.dir > 0 ? c.head < (double)c.hi - 0.5 : c.head > (double)c.lo + 0.5;
      if (hasRoom) out[count++] = c;
    }
    return count;
  }

  void drawTrail(const RecipeLayer& layer, LayerState& state, bool fired, uint32_t dt) {
    Front* fronts = state.fronts;
    const int32_t length = (int32_t)layer.numbers[RecipeSlot::TrailLength];
    if (fired) {
      const double speed = fmax(0.0, knobValue(layer.knobs[RecipeSlot::TrailSpeed]));
      const float bright = (float)recipeClamp01(knobValue(layer.knobs[RecipeSlot::TrailBrightness]));
      const uint8_t limit = (uint8_t)layer.numbers[RecipeSlot::TrailMaxFronts];
      Spawn spawns[4];
      const uint8_t count = trailSpawns((RecipeTrailOrigin)choiceOf(layer, RecipeSlot::TrailFrom),
                                        layer.numbers[RecipeSlot::TrailFlatZone], spawns);
      for (uint8_t s = 0; s < count; s++) {
        uint8_t slot = 0;
        while (slot < limit && fronts[slot].active) slot++;
        if (slot >= limit) break;
        fronts[slot] = Front{spawns[s].head, speed, spawns[s].lo, spawns[s].hi, bright, spawns[s].dir, true};
      }
    }

    for (uint8_t k = 0; k < RECIPE_MAX_FRONTS; k++) {
      Front& front = fronts[k];
      if (!front.active) continue;
      front.head += ((double)front.dir * front.speed * (double)dt) / 1000.0;
      if (front.dir > 0 && front.head > (double)(front.hi + length)) front.active = false;
      if (front.dir < 0 && front.head < (double)(front.lo - length)) front.active = false;
    }

    const int32_t count = layout_.count;
    for (uint8_t k = 0; k < RECIPE_MAX_FRONTS; k++) {
      const Front& front = fronts[k];
      if (!front.active) continue;
      const int32_t head = recipeRound(front.head);
      for (int32_t d = 0; d < length; d++) {
        const int32_t p = head - front.dir * d;
        if (p < front.lo || p > front.hi) continue;
        const float u = length <= 1 ? 0.0f : (float)d / (float)(length - 1);
        paint(layer, recipeWrapIndex(p, count), u, false, front.bright, 1.0f);
      }
    }
  }

  void drawFlash(const RecipeLayer& layer, LayerState& state, bool fired, uint32_t dt) {
    const uint32_t fade = (uint32_t)layer.numbers[RecipeSlot::FlashFadeMs];
    if (fired) {
      state.flashRemainMs = fade;
      state.flashBright = recipeClamp01(knobValue(layer.knobs[RecipeSlot::FlashBrightness]));
    }
    const float level = (float)state.flashRemainMs / (float)fade;
    if (level > 0.0f) {
      // Every pixel gets the same color, so it's worked out once.
      float color[3];
      samplePalette(layer, 1.0f - level, false, color);
      const float bright = (float)state.flashBright;
      for (uint16_t i = 0; i < layout_.count; i++) setPixel(i, color, bright, level);
    }
    state.flashRemainMs = state.flashRemainMs > dt ? state.flashRemainMs - dt : 0;
  }

  void drawSparkle(const RecipeLayer& layer, LayerState& state, uint32_t dt) {
    const uint16_t count = layout_.count;
    float* level = state.sparkle.level;
    float* hue = state.sparkle.hue;
    const float decay = (float)dt / layer.numbers[RecipeSlot::SparkleFadeMs];
    for (uint16_t i = 0; i < count; i++) {
      const float next = level[i] - decay;
      level[i] = next > 0.0f ? next : 0.0f;
    }

    state.pending += (fmax(0.0, knobValue(layer.knobs[RecipeSlot::SparkleDensity])) * (double)dt) / 1000.0;
    while (state.pending >= 1.0) {
      state.pending -= 1.0;
      const uint32_t pixel = nextRandom() % count;
      level[pixel] = 1.0f;
      hue[pixel] = (float)((double)nextRandom() / 4294967296.0);
    }

    const float bright = (float)recipeClamp01(knobValue(layer.knobs[RecipeSlot::SparkleBrightness]));
    for (uint16_t i = 0; i < count; i++) {
      if (level[i] > 0.0f) paint(layer, i, hue[i], false, bright, level[i]);
    }
  }

  void drawChase(const RecipeLayer& layer, LayerState& state, uint32_t dt) {
    const int32_t count = layout_.count;
    const double speed = knobValue(layer.knobs[RecipeSlot::ChaseSpeed]);
    if (speed != 0.0) state.dir = speed > 0.0 ? 1 : -1;
    const int32_t comets = (int32_t)layer.numbers[RecipeSlot::ChaseCount];
    const int32_t length = (int32_t)layer.numbers[RecipeSlot::ChaseLength];
    const float bright = (float)recipeClamp01(knobValue(layer.knobs[RecipeSlot::ChaseBrightness]));
    if ((RecipeChasePath)choiceOf(layer, RecipeSlot::ChasePath) == RecipeChasePath::Foot) {
      drawFootChase(layer, state, fabs(speed), comets, length, bright, dt);
      return;
    }

    state.position = recipeWrap(state.position + (speed * (double)dt) / 1000.0, (double)count);
    for (int32_t k = 0; k < comets; k++) {
      const int32_t head = recipeRound(state.position + ((double)k * (double)count) / (double)comets);
      // Tail first, so a head that overlaps another comet's tail stays on top.
      for (int32_t d = length - 1; d >= 0; d--) {
        const int32_t p = recipeWrapIndex(head - state.dir * d, count);
        const float u = length <= 1 ? 0.0f : (float)d / (float)(length - 1);
        paint(layer, p, u, false, bright, 1.0f - (float)d / (float)length);
      }
    }
  }

  // Comets that run up both sides of the foot side by side, heel to toe, or toe to heel when the
  // speed is negative. Progress counts pixels along an average side from the starting end, and each
  // lap is a comet's length longer than a side, so its tail leaves the far end before it comes back
  // in at the start.
  void drawFootChase(const RecipeLayer& layer, LayerState& state, double speed, int32_t comets, int32_t length,
                     float bright, uint32_t dt) {
    const int32_t count = layout_.count;
    const double side = (double)count / 2.0;
    const double lap = side + (double)length;
    state.progress = recipeWrap(state.progress + (speed * (double)dt) / 1000.0, lap);
    for (int32_t k = 0; k < comets; k++) {
      const double head = fmod(state.progress + ((double)k * lap) / (double)comets, lap);
      for (int32_t d = length - 1; d >= 0; d--) {
        const double along = (head - (double)d) / side;
        if (along < 0.0 || along > 1.0) continue;
        const double s = state.dir > 0 ? along : 1.0 - along;
        const float u = length <= 1 ? 0.0f : (float)d / (float)(length - 1);
        const float alpha = 1.0f - (float)d / (float)length;
        paint(layer, recipeWrapIndex((int32_t)layout_.heel + recipeRound(s * (double)heelToToe_), count), u, false, bright, alpha);
        paint(layer, recipeWrapIndex((int32_t)layout_.toe + recipeRound((1.0 - s) * (double)toeToHeel_), count), u, false, bright, alpha);
      }
    }
  }

  void composite(const RecipeLayer& layer) {
    const float opacity = (float)recipeClamp01(knobValue(layer.knobs[RECIPE_OPACITY_SLOT]));
    if (opacity == 0.0f) return;
    const RecipeBlend blend = (RecipeBlend)layer.choices[RECIPE_BLEND_SLOT];
    for (uint16_t i = 0; i < layout_.count; i++) {
      const float a = layerAlpha_[i] * opacity;
      if (a == 0.0f) continue;
      for (uint8_t c = 0; c < 3; c++) {
        const uint16_t at = i * 3 + c;
        const float below = frame_[at];
        const float color = layerColor_[at];
        switch (blend) {
          case RecipeBlend::Over:
            frame_[at] = below + (color - below) * a;
            break;
          case RecipeBlend::Add:
            frame_[at] = fminf(1.0f, below + color * a);
            break;
          case RecipeBlend::Max:
            frame_[at] = fmaxf(below, color * a);
            break;
          case RecipeBlend::Multiply:
            frame_[at] = below * (1.0f - a + color * a);
            break;
        }
      }
    }
  }

  // xorshift32, the same as the TypeScript engine, in the same order of draws.
  uint32_t nextRandom() {
    uint32_t x = rng_;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    rng_ = x;
    return x;
  }

  const Recipe* recipe_ = nullptr;
  StripLayout layout_ = {0, 0, 0};
  int32_t toeToHeel_ = 0;
  int32_t heelToToe_ = 0;
  uint32_t timeMs_ = 0;
  uint32_t sinceStompMs_ = 0;
  bool stompSeen_ = false;
  double tilt_ = 0.0;
  double lastStrength_ = 0.0;
  uint32_t rng_ = RECIPE_RNG_SEED;
  float frame_[MaxPixels * 3];
  float layerColor_[MaxPixels * 3];
  float layerAlpha_[MaxPixels];
  float positions_[MaxPixels];
  LayerState states_[RECIPE_MAX_LAYERS];
};

}  // namespace Firewalker
