// Firewalker Shoes — button-triggered fire trails (Arduino Uno R3).
//
// At rest the strip is dark. Each button "stomp" spawns a TRAIL: a band of
// TRAIL_LEN pixels that travels from the bottom of the strip to the top. The
// band is a fire gradient — bright white at the leading (head) pixel, cooling
// through yellow -> orange -> red toward the tail. It "wipes in" as it emerges
// from the bottom and "wipes out" as it slides off the top — no hold. Presses
// stack: several trails run at once, each chasing the previous up the strip.
//
// Design notes:
//   * Non-blocking: the loop never calls delay(), so the button stays
//     responsive. All timing is one millis()-driven step tick shared by every
//     trail, so they advance in lockstep and their spacing is just when you
//     pressed. Same pattern we'll reuse for a real accelerometer step-detect.
//   * A trail is the pixel band [head-TRAIL_LEN+1 .. head]; render only draws
//     indices inside [0, LED_COUNT). That clamp gives wipe-in at the bottom and
//     wipe-out at the top for free — no edge special-casing.
//   * The fire gradient is identical for every trail, so it's precomputed once
//     into trailColor[] at boot; the render loop just indexes it.
//
// The button is a temporary stand-in for a stomp; see docs/wiring.md.

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>

#include "config.h"

// One WS2812B strip on LED_PIN. GRB color order, 800 KHz data rate. If colors
// come out swapped, the color-order flag here is the first thing to revisit.
Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

// ── Fire gradient ───────────────────────────────────────────────────────────
// The FIRE[] palette and FIRE_STOPS come from config.h. fireColor() interpolates
// them across the band length; trailColor[] caches the result (filled in setup).

// Color for a pixel `d` steps behind the head across a band of `span` pixels:
// d=0 -> first stop (white), d=span-1 -> last stop (red), linear in between.
// Integer piecewise-lerp; called only at boot (TRAIL_LEN times), never per frame.
static uint32_t fireColor(uint8_t d, uint8_t span) {
  if (span <= 1) return strip.Color(FIRE[0][0], FIRE[0][1], FIRE[0][2]);
  uint16_t scaled = (uint16_t)d * ((FIRE_STOPS - 1) * 256) / (span - 1);  // 0 .. (stops-1)*256
  uint8_t seg  = scaled >> 8;     // segment index between two stops
  uint8_t frac = scaled & 0xFF;   // position within that segment, 0..255
  if (seg >= FIRE_STOPS - 1) { seg = FIRE_STOPS - 2; frac = 255; }         // clamp the top end
  uint8_t r = FIRE[seg][0] + (int)(FIRE[seg + 1][0] - FIRE[seg][0]) * frac / 255;
  uint8_t g = FIRE[seg][1] + (int)(FIRE[seg + 1][1] - FIRE[seg][1]) * frac / 255;
  uint8_t b = FIRE[seg][2] + (int)(FIRE[seg + 1][2] - FIRE[seg][2]) * frac / 255;
  return strip.Color(r, g, b);
}

static uint32_t trailColor[TRAIL_LEN];  // gradient cache, filled in setup()

// ── Trails ──────────────────────────────────────────────────────────────────
// `head` is the index of the band's leading (top) edge. A trail is "done" once
// even its trailing pixel has climbed past the top of the strip.
struct Trail {
  int16_t head;
  bool    active;
};
static Trail         trails[MAX_TRAILS];   // zero-initialised => all inactive
static uint8_t       activeCount = 0;
static unsigned long lastStepMs  = 0;      // shared step tick for every trail

// Debounced, edge-triggered button read. Returns true exactly once per clean
// press: the HIGH->LOW transition after the raw reading has been stable for
// DEBOUNCE_MS. With INPUT_PULLUP, LOW means pressed.
static bool buttonPressed() {
  static bool          stable       = HIGH;  // last debounced level
  static bool          lastReading  = HIGH;  // last raw sample
  static unsigned long lastChangeMs = 0;

  bool reading = digitalRead(BUTTON_PIN);
  if (reading != lastReading) {       // raw level moved -> (re)start debounce timer
    lastReading  = reading;
    lastChangeMs = millis();
  }
  if ((millis() - lastChangeMs) >= DEBOUNCE_MS && reading != stable) {
    stable = reading;                 // reading has settled into a new level
    if (stable == LOW) return true;   // settled into "pressed"
  }
  return false;
}

// Start a new trail at the bottom. Behind any trails already climbing, since
// those have a higher `head`. Ignored if all MAX_TRAILS slots are in use.
static void spawnTrail() {
  for (uint8_t i = 0; i < MAX_TRAILS; i++) {
    if (!trails[i].active) {
      if (activeCount == 0) lastStepMs = millis();  // align the tick for a fresh field
      trails[i].head   = 0;
      trails[i].active = true;
      activeCount++;
      Serial.print(F("[firewalker] stomp -> trail (")); Serial.print(activeCount);
      Serial.println(F(" active)"));
      return;
    }
  }
  Serial.println(F("[firewalker] stomp ignored — MAX_TRAILS reached"));
}

// Advance every trail one pixel up; retire any whose band has fully exited.
static void advanceTrails() {
  for (uint8_t i = 0; i < MAX_TRAILS; i++) {
    if (!trails[i].active) continue;
    trails[i].head++;
    int16_t bottom = trails[i].head - (TRAIL_LEN - 1);  // band's trailing pixel
    if (bottom >= (int16_t)LED_COUNT) {                 // whole band past the top
      trails[i].active = false;
      activeCount--;
    }
  }
}

// Draw the current frame: clear, then paint each active trail's band with the
// cached fire gradient, clamped to the strip. Overlapping bands re-set pixels.
static void render() {
  strip.clear();
  for (uint8_t i = 0; i < MAX_TRAILS; i++) {
    if (!trails[i].active) continue;
    for (uint8_t d = 0; d < TRAIL_LEN; d++) {
      int16_t pos = trails[i].head - d;
      if (pos >= 0 && pos < (int16_t)LED_COUNT) {
        strip.setPixelColor(pos, trailColor[d]);
      }
    }
  }
  strip.show();
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(200);  // Uno resets when the serial port opens; let the first prints land.

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  for (uint8_t d = 0; d < TRAIL_LEN; d++) trailColor[d] = fireColor(d, TRAIL_LEN);

  strip.begin();
  strip.setBrightness(LED_BRIGHTNESS);
  strip.clear();
  strip.show();                       // start dark

  Serial.println(F("[firewalker] ready — press the button to stomp"));
  Serial.print(F("[firewalker] pixels=")); Serial.print(LED_COUNT);
  Serial.print(F(" button pin=")); Serial.println(BUTTON_PIN);
}

void loop() {
  // A press spawns a new trail; render right away so the press feels instant.
  if (buttonPressed()) {
    spawnTrail();
    render();
  }

  // Shared step tick: advance all trails together, then redraw. Idle when no
  // trails are active (strip already dark — nothing to do).
  if (activeCount > 0 && (millis() - lastStepMs) >= WIPE_STEP_MS) {
    lastStepMs = millis();
    advanceTrails();
    render();
  }
}
