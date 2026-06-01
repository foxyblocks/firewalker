// Firewalker Shoes — button-triggered color wipe (Arduino Uno R3).
//
// At rest the strip is dark. Each button "stomp" runs a color wipe: the fill
// color lights on one pixel at a time from the bottom of the strip to the top,
// the lit region growing until the whole strip is on. It then holds briefly and
// clears, leaving the strip ready for the next press.
//
// Design notes:
//   * Non-blocking: the loop never calls delay() during the animation, so the
//     button stays responsive and debouncing works. All timing is driven by
//     millis() + a small state machine. This is the pattern we'll reuse when
//     the button is replaced by a real accelerometer step-detect.
//
// The button is a temporary stand-in for a stomp; see docs/wiring.md.

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>

#include "config.h"

// One WS2812B strip on LED_PIN. GRB color order, 800 KHz data rate. If colors
// come out swapped, the color-order flag here is the first thing to revisit.
Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

// ── Animation state ───────────────────────────────────────────────────────
enum class Anim : uint8_t { Idle, Wiping, Holding };
static Anim          animState   = Anim::Idle;
static uint16_t      head        = 0;   // highest pixel lit so far, 0 .. LED_COUNT-1
static unsigned long lastStepMs  = 0;   // when the wipe last advanced
static unsigned long holdStartMs = 0;   // when the full-strip hold began

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

static void lightPixel(uint16_t i) {
  strip.setPixelColor(i, strip.Color(FILL_R, FILL_G, FILL_B));
}

// (Re)start the wipe from the bottom: clear, light pixel 0, arm the timer.
static void startWipe() {
  animState = Anim::Wiping;
  head      = 0;
  strip.clear();
  lightPixel(0);
  strip.show();
  lastStepMs = millis();
  Serial.println(F("[firewalker] stomp -> wipe start"));
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(200);  // Uno resets when the serial port opens; let the first prints land.

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  strip.begin();
  strip.setBrightness(LED_BRIGHTNESS);
  strip.clear();
  strip.show();                       // start dark

  Serial.println(F("[firewalker] ready — press the button to stomp"));
  Serial.print(F("[firewalker] pixels=")); Serial.print(LED_COUNT);
  Serial.print(F(" button pin=")); Serial.println(BUTTON_PIN);
}

void loop() {
  // A press always (re)starts the wipe, even mid-sweep, so every stomp gives a
  // fresh traversal from the bottom.
  if (buttonPressed()) {
    startWipe();
  }

  switch (animState) {
    case Anim::Wiping:
      if (millis() - lastStepMs >= WIPE_STEP_MS) {
        lastStepMs = millis();
        if (head + 1 >= LED_COUNT) {
          // Whole strip is lit: start the hold.
          animState   = Anim::Holding;
          holdStartMs = millis();
        } else {
          head++;
          lightPixel(head);           // previously-lit pixels stay on (growing fill)
          strip.show();
        }
      }
      break;

    case Anim::Holding:
      if (millis() - holdStartMs >= HOLD_MS) {
        strip.clear();
        strip.show();
        animState = Anim::Idle;
        Serial.println(F("[firewalker] wipe done — cleared"));
      }
      break;

    case Anim::Idle:
    default:
      break;  // strip stays dark, waiting for the next press
  }
}
