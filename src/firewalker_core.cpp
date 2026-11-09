#include "firewalker_core.h"

#include "config.h"

namespace Firewalker {

LedStrip strip(STRIP_MAX_PIXELS);

static StripLayout currentLayout = STRIP_DEFAULT_LAYOUT;

// LED_BUILTIN maps to the MG24 Sense's active-low user LED on PA7. Keep its
// electrical polarity here so status patterns and identify use the same output.
static void setStatusLight(bool lit) {
  digitalWrite(LED_BUILTIN, lit ? LED_BUILTIN_ACTIVE : LED_BUILTIN_INACTIVE);
}

const StripLayout& stripLayout() { return currentLayout; }

void setStripLayout(const StripLayout& layout) {
  currentLayout = layout;
  strip.setPixelCount(layout.count);
}

void setupCore(const __FlashStringHelper* modeName) {
  Serial.begin(SERIAL_BAUD);
  delay(200);

  pinMode(LED_BUILTIN, OUTPUT);
  setStatusLight(true);

  strip.begin();
  strip.setBrightness(LED_BRIGHTNESS);
  strip.clear();
  strip.show();

  Serial.print(F("[firewalker] mode="));
  Serial.print(modeName);
  Serial.print(F(" pixels="));
  Serial.print(currentLayout.count);
  Serial.print(F(" toe="));
  Serial.print(currentLayout.toe);
  Serial.print(F(" heel="));
  Serial.println(currentLayout.heel);
}

// Channels are scaled here rather than with setBrightness so a caller's computed
// level isn't compounded with the strip's own global brightness.
void renderIdleBrightness(uint8_t brightness) {
  if (brightness > LED_BRIGHTNESS) brightness = LED_BRIGHTNESS;
  strip.setBrightness(LED_BRIGHTNESS);
  uint32_t color = strip.Color(
      (uint16_t)IDLE_FILL_R * brightness / LED_BRIGHTNESS,
      (uint16_t)IDLE_FILL_G * brightness / LED_BRIGHTNESS,
      (uint16_t)IDLE_FILL_B * brightness / LED_BRIGHTNESS);
  for (uint16_t i = 0; i < strip.numPixels(); i++) {
    strip.setPixelColor(i, color);
  }
  strip.show();
}

void renderIdentifyBlink(bool lit) {
  const uint32_t color = lit ? IDENTIFY_COLOR : 0;
  for (uint16_t i = 0; i < strip.numPixels(); i++) strip.setPixelColor(i, color);
  strip.show();
  setStatusLight(lit);
}

void updateStatusLight(StatusLight state) {
  unsigned long halfPeriodMs = 0;
  if (state == StatusLight::SensorMissing) halfPeriodMs = STATUS_BLINK_SLOW_MS;
  if (state == StatusLight::Calibrating) halfPeriodMs = STATUS_BLINK_FAST_MS;

  const bool lit = (halfPeriodMs == 0) || ((millis() / halfPeriodMs) % 2 == 0);
  setStatusLight(lit);
}

}  // namespace Firewalker
