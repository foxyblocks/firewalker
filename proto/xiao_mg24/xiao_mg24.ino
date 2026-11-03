// XIAO MG24 (Sense) flow prototype.
//
// Runs the board-agnostic Firewalker patterns on the all-in-one Seeed XIAO MG24
// Sense (Silicon Labs EFR32MG24): the onboard LSM6DS3 IMU drives the fused
// fore-aft tilt + stomp, and the active pattern renders to a 160-pixel WS2812 ring
// on the D10 pad. A momentary button on D1 cycles modes: flow -> fire-trail ->
// off. This is a hardware-evaluation branch — does the all-in-one XIAO replace
// the Feather + GY-521 stack? See proto/xiao_mg24/README.md.
//
// What is reused vs. board-specific:
//   * Reused unchanged from the main firmware: the flow + fire-trail patterns and
//     their engines (src/patterns/*.cpp via src/*_unit.cpp), the orientation/
//     stomp fusion (include/firewalker_fusion.h), the strip ring geometry
//     (include/firewalker_strip_map.h), and the behavior knobs (include/config.h
//     FLOW_*/FIRE_*/IMU thresholds).
//   * Board-specific (this dir): the LSM6DS3 IMU adapter (src/imu_xiao.cpp), the
//     strip object on D10 (src/xiao_strip.cpp), the D1 mode button (below), and the
//     Adafruit_NeoPixel compat shim backed by a self-calibrating WS2812 bit-bang
//     (Adafruit_NeoPixel.h).
#include <Arduino.h>

#include "config.h"
#include "firewalker_core.h"  // Firewalker::strip (defined in src/xiao_strip.cpp)
#include "firewalker_imu.h"   // Firewalker::imu*  (LSM6DS3 adapter in src/imu_xiao.cpp)
#include "patterns/fire_trail.h"
#include "patterns/flow.h"
#include "patterns/pattern.h"

using namespace Firewalker;

// Prototype-local strip brightness (0-255), applied after a pattern's enter() so
// it overrides config.h's Feather LED_BRIGHTNESS. The shim outputs full-range
// (no half-brightness quirk). Start the 160-pixel USB bench test dimly; this
// scales the requested colors and does not enforce a measured current limit.
static constexpr uint8_t XIAO_BRIGHTNESS = 16;

// Mode-cycle button. Momentary switch from D1 to GND, using the internal pull-up
// (pressed = LOW), matching the main firmware's D6 button. If yours is wired to
// 3V3 instead, invert the press test in buttonPressed().
static constexpr uint8_t XIAO_BUTTON_PIN = D1;
static constexpr unsigned long XIAO_BUTTON_DEBOUNCE_MS = 30;

// Stream raw IMU + fused tilt (~10 Hz) for bench axis calibration. NOTE: on this
// board Serial is the EUSART0 UART (pins D12=TX/D11=RX), NOT USB CDC — this is
// only readable with a UART adapter on D12, not over the USB port. Off by
// default; enable if you've hooked up an adapter to re-check the mount map.
static constexpr bool XIAO_IMU_CALIBRATION_LOG = false;

// DIAGNOSTIC: when true, suppress stomps so only the flow background (cycling
// hue + tilt fill gauge) renders. Left in as a calibration aid. False = normal.
static constexpr bool XIAO_DISABLE_STOMPS = false;

// Modes: indices 0..PATTERN_COUNT-1 select a pattern; PATTERN_COUNT is "off"
// (strip blanked). D1 advances through them and wraps.
static FlowPattern flow;
static FireTrailPattern fireTrail;
static Pattern* patterns[] = {&flow, &fireTrail};
static const uint8_t PATTERN_COUNT = sizeof(patterns) / sizeof(patterns[0]);
static const uint8_t MODE_COUNT = PATTERN_COUNT + 1;  // + off
static uint8_t mode = 0;

static unsigned long lastUpdateMs = 0;

// Edge-triggered, debounced read of the D1 button: true once per press.
static bool buttonPressed() {
  static bool lastStable = HIGH;  // released (internal pull-up holds high)
  static bool lastRead = HIGH;
  static unsigned long lastChangeMs = 0;

  bool r = digitalRead(XIAO_BUTTON_PIN);
  unsigned long now = millis();
  if (r != lastRead) {
    lastRead = r;
    lastChangeMs = now;
  }
  if ((now - lastChangeMs) >= XIAO_BUTTON_DEBOUNCE_MS && r != lastStable) {
    lastStable = r;
    if (lastStable == LOW) return true;  // HIGH->LOW settled = a press
  }
  return false;
}

static void logMode(const __FlashStringHelper* prefix) {
  Serial.print(prefix);
  if (mode < PATTERN_COUNT) {
    Serial.println(patterns[mode]->name());
  } else {
    Serial.println(F("off"));
  }
}

// Enter the current mode: reset the pattern's state (and re-apply our brightness,
// since enter() resets it to config.h's LED_BRIGHTNESS), or blank the strip for
// "off".
static void enterMode() {
  if (mode < PATTERN_COUNT) {
    patterns[mode]->enter();
    strip.setBrightness(XIAO_BRIGHTNESS);
  } else {
    strip.clear();
    strip.show();
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("[firewalker] XIAO MG24 Sense — flow prototype"));

  pinMode(XIAO_BUTTON_PIN, INPUT_PULLUP);

  strip.begin();
  strip.clear();
  strip.show();

  imuBegin();

  mode = 0;  // boot into flow
  enterMode();
  logMode(F("[firewalker] mode -> "));

  lastUpdateMs = millis();
}

void loop() {
  imuUpdate();  // poll IMU; keep fused tilt + stomp state fresh in every mode

  if (buttonPressed()) {
    mode = (mode + 1) % MODE_COUNT;
    logMode(F("[firewalker] D1 pressed, mode -> "));
    enterMode();
  }

  unsigned long now = millis();
  PatternInput in;
  in.tiltFwd = imuTiltFwd();
  in.stomp = XIAO_DISABLE_STOMPS ? false : imuTakeStomp();
  in.stompStrength = imuStompStrength();
  in.dt = now - lastUpdateMs;
  lastUpdateMs = now;

  // A pattern renders + pushes the frame; "off" leaves the strip blanked.
  if (mode < PATTERN_COUNT) {
    patterns[mode]->update(in);
  }

  if (XIAO_IMU_CALIBRATION_LOG) imuLog();
}
