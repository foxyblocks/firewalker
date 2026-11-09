// bench runs one strip test configured entirely by build flags, so a test never
// edits firmware settings or touches a shoe's saved settings. The `cli` tool
// generates these flags (see tools/cli), and the strip_test and strip_off
// environments in platformio.ini use fixed ones. Pattern tests run the real flow and
// fire-trail implementations, with simulated tilt and impacts unless BENCH_MOTION is
// set. Motion-free builds never start the sensor. Every frame covers the whole strip,
// with black for any pixel a test leaves unlit.
//
//   BENCH_TEST: 0 flow, 1 fire-trail, 2 color, 3 off

#include "modes/bench.h"

#include <Arduino.h>

#include "config.h"
#include "firewalker_core.h"
#include "firewalker_imu.h"
#include "patterns/fire_trail.h"
#include "patterns/flow.h"

#ifndef BENCH_TEST
#define BENCH_TEST 2
#endif
#ifndef BENCH_LIT_PIXELS
#define BENCH_LIT_PIXELS STRIP_MAX_PIXELS
#endif
#ifndef BENCH_MOTION
#define BENCH_MOTION 0
#endif
#ifndef BENCH_LOG_MOTION
#define BENCH_LOG_MOTION 0
#endif
#ifndef BENCH_TILT
#define BENCH_TILT 0.0f
#endif
#ifndef BENCH_STOMP_MS
#define BENCH_STOMP_MS 0UL
#endif
#ifndef BENCH_INTERVAL_MS
#define BENCH_INTERVAL_MS 500UL
#endif
#ifndef BENCH_COLOR_CYCLE
#define BENCH_COLOR_CYCLE 1
#endif
#ifndef BENCH_COLOR_RGB
#define BENCH_COLOR_RGB 0xFFFFFFUL
#endif

namespace BenchMode {

using namespace Firewalker;

#if BENCH_TEST == 0
static FlowPattern pattern;
#elif BENCH_TEST == 1
static FireTrailPattern pattern;
#endif

static unsigned long lastFrameMs = 0;
static unsigned long lastImpactMs = 0;

// Writes a complete frame so a shorter lit section can't leave old colors on
// downstream pixels. The global brightness scales both fixed colors and white.
static void showColor(uint32_t color) {
  strip.clear();
  for (uint16_t i = 0; i < BENCH_LIT_PIXELS; i++) {
    strip.setPixelColor(i, color);
  }
  strip.show();
}

void setup() {
  setupCore(F("bench"));

#if BENCH_MOTION
  // With no sensor the strip stays black, and the onboard LED's slow blink says why,
  // rather than silently showing a motion-free baseline.
  if (!imuBegin()) {
    while (true) {
      updateStatusLight(StatusLight::SensorMissing);
      delay(10);
    }
  }
  imuLoadSavedCalibration();
#endif

#if BENCH_TEST <= 1
  pattern.enter();
#elif BENCH_TEST == 3
  digitalWrite(LED_BUILTIN, LED_BUILTIN_INACTIVE);
#endif
  lastFrameMs = lastImpactMs = millis();
}

void loop() {
#if BENCH_TEST <= 1
  const unsigned long now = millis();
  PatternInput input{};
  input.dt = now - lastFrameMs;
  lastFrameMs = now;
  input.tiltFwd = BENCH_TILT;
  input.tiltDeg = BENCH_TILT * IMU_TILT_FULL_DEG;  // a simulated full tilt is the default range
  input.stompStrength = 1.0f;
#if BENCH_MOTION
  imuUpdate();
  input.tiltFwd = imuTiltFwd();
  input.tiltDeg = imuTiltDeg();
  input.stomp = imuTakeStomp();
  input.stompStrength = imuStompStrength();
#if BENCH_LOG_MOTION
  imuLog();
#endif
#else
  // Only simulated tests use timed impacts. An interval of zero means no impacts.
  if (BENCH_STOMP_MS > 0 && now - lastImpactMs >= BENCH_STOMP_MS) {
    input.stomp = true;
    lastImpactMs = now;
  }
#endif
  pattern.update(input);
  delay(1);
#elif BENCH_TEST == 2
  static const uint32_t cycle[] = {0xFFFFFF, 0xFF0000, 0x00FF00, 0x0000FF};
  static uint8_t cycleIndex = 0;
  showColor(BENCH_COLOR_CYCLE ? cycle[cycleIndex] : BENCH_COLOR_RGB);
  cycleIndex = (cycleIndex + 1) % 4;
  delay(BENCH_INTERVAL_MS);
#else
  // Repeat black so the strip stays blank even if its power is cycled separately.
  // This doesn't remove power: all pixels still draw their idle current.
  showColor(0);
  delay(100);
#endif
}

}  // namespace BenchMode
