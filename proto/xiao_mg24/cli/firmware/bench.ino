/**
 * Bench-only test entry point, configured by the Cobra CLI's generated header.
 * Pattern builds reuse the actual flow/fire-trail implementations and the MG24
 * strip driver; the CLI copies only the selected pattern into a temporary
 * sketch. Motion-free builds do not compile or initialize the motion sensor.
 * Every frame covers the connected strip, including black for inactive pixels.
 */
#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include "bench_settings.h"

#if BENCH_MODE == 0
#include "patterns/flow.h"
#elif BENCH_MODE == 1
#include "patterns/fire_trail.h"
#endif

#if BENCH_MOTION
#include "firewalker_imu.h"
#endif

namespace Firewalker {
Adafruit_NeoPixel strip(BENCH_PIXELS, D10, NEO_GRB + NEO_KHZ800);
}
using namespace Firewalker;

#if BENCH_MODE == 0
static FlowPattern pattern;
#elif BENCH_MODE == 1
static FireTrailPattern pattern;
#endif

static unsigned long lastFrameMs;
static unsigned long lastTriggerMs;

// Write a complete frame so a shorter lit section cannot leave old colors on
// downstream pixels. The global brightness scales both fixed colors and white.
static void showColor(uint32_t color) {
  strip.clear();
  for (uint16_t i = 0; i < BENCH_LIT_PIXELS; i++) {
    strip.setPixelColor(i, color);
  }
  strip.show();
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LED_BUILTIN_ACTIVE);
  strip.begin();
  strip.setBrightness(BENCH_BRIGHTNESS);
  strip.clear();
  strip.show();

#if BENCH_MOTION
  // Failure leaves the strip black; a slow onboard blink identifies a missing
  // sensor instead of silently showing a motion-free baseline.
  if (!imuBegin()) {
    while (true) {
      digitalWrite(LED_BUILTIN, LED_BUILTIN_ACTIVE);
      delay(500);
      digitalWrite(LED_BUILTIN, LED_BUILTIN_INACTIVE);
      delay(500);
    }
  }
#endif

#if BENCH_MODE <= 1
  pattern.enter();
  strip.setBrightness(BENCH_BRIGHTNESS);
#elif BENCH_MODE == 3
  digitalWrite(LED_BUILTIN, LED_BUILTIN_INACTIVE);
#elif BENCH_MODE == 4
  // First clear the strip, then hold the data pin at 3.3V for a multimeter.
  // This is a DC continuity probe, not an LED animation.
  digitalWrite(D10, HIGH);
#endif
  lastFrameMs = lastTriggerMs = millis();
}

void loop() {
#if BENCH_MODE <= 1
  unsigned long now = millis();
  PatternInput input{};
  input.dt = now - lastFrameMs;
  lastFrameMs = now;
  input.tiltFwd = BENCH_TILT;
  input.stompStrength = 1.0f;
#if BENCH_MOTION
  imuUpdate();
  input.tiltFwd = imuTiltFwd();
  input.stomp = imuTakeStomp();
  input.stompStrength = imuStompStrength();
#if BENCH_LOG_MOTION
  imuLog();
#endif
#else
  // Only simulated tests use timed impacts. A zero interval means no impacts;
  // the default flow therefore needs neither movement nor a motion sensor.
  if (BENCH_STOMP_MS > 0 && now - lastTriggerMs >= BENCH_STOMP_MS) {
    input.stomp = true;
    lastTriggerMs = now;
  }
#endif
  pattern.update(input);
  delay(1);
#elif BENCH_MODE == 2
  static const uint32_t colors[] = {0xFFFFFF, 0xFF0000, 0x00FF00, 0x0000FF};
  static uint8_t colorIndex = 0;
  showColor(BENCH_COLOR_CYCLE ? colors[colorIndex] : BENCH_COLOR_RGB);
  colorIndex = (colorIndex + 1) % 4;
  delay(BENCH_INTERVAL_MS);
#elif BENCH_MODE == 3
  strip.clear();
  strip.show();
  delay(100);  // black pixels still consume controller idle power
#else
  delay(100);  // probe leaves D10 held HIGH
#endif
}
