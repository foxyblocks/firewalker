#include "firewalker_core.h"

#include <Adafruit_NeoPixel.h>

#include "config.h"

namespace Firewalker {

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

// Single built-in status NeoPixel on the Feather (separate data pin from the
// main strip). Lit solid by setupCore() in every mode.
Adafruit_NeoPixel onboard(1, ONBOARD_PIXEL_PIN, NEO_GRB + NEO_KHZ800);

static void showBootPixel() {
  if (!BOOT_PIXEL_DEBUG || BOOT_PIXEL_INDEX >= LED_COUNT) return;

  strip.setPixelColor(
      BOOT_PIXEL_INDEX,
      strip.Color(BOOT_PIXEL_R, BOOT_PIXEL_G, BOOT_PIXEL_B));
  strip.show();
}

void setupCore(const __FlashStringHelper* modeName) {
  Serial.begin(SERIAL_BAUD);
  delay(200);

  // Solid onboard NeoPixel in every mode: a power/firmware-running indicator
  // that doesn't depend on the main strip or a serial monitor.
  if (ONBOARD_PIXEL_ENABLED) {
    onboard.begin();
    onboard.setBrightness(ONBOARD_PIXEL_BRIGHTNESS);
    onboard.setPixelColor(
        0, onboard.Color(ONBOARD_PIXEL_R, ONBOARD_PIXEL_G, ONBOARD_PIXEL_B));
    onboard.show();
  }

  if (DEBUG_BUTTON_ENABLED) pinMode(DEBUG_BUTTON_PIN, INPUT_PULLUP);

  strip.begin();
  strip.setBrightness(LED_BRIGHTNESS);
  strip.clear();
  strip.show();
  showBootPixel();

  Serial.print(F("[firewalker] mode="));
  Serial.println(modeName);
  Serial.print(F("[firewalker] pixels="));
  Serial.print(LED_COUNT);
  Serial.print(F(" led pin="));
  Serial.print(LED_PIN);
  Serial.print(F(" button pin="));
  Serial.print(DEBUG_BUTTON_ENABLED ? DEBUG_BUTTON_PIN : -1);
  Serial.print(F(" foot="));
  Serial.println(FOOT_IS_LEFT ? F("left") : F("right"));
}

bool debugButtonPressed() {
  if (!DEBUG_BUTTON_ENABLED) return false;

  static bool          stable       = HIGH;
  static bool          lastReading  = HIGH;
  static unsigned long lastChangeMs = 0;

  bool reading = digitalRead(DEBUG_BUTTON_PIN);
  if (reading != lastReading) {
    lastReading = reading;
    lastChangeMs = millis();
  }

  if ((millis() - lastChangeMs) >= DEBUG_BUTTON_DEBOUNCE_MS && reading != stable) {
    stable = reading;
    if (DEBUG_BUTTON_LOG) {
      Serial.print(F("[firewalker] button "));
      Serial.print(stable == LOW ? F("DOWN") : F("UP"));
      Serial.print(F(" @"));
      Serial.print(millis());
      Serial.println(F("ms"));
    }
    if (stable == LOW) return true;
  }

  return false;
}

// Fill the whole strip with the idle color, scaled to `brightness` on a
// 0..LED_BRIGHTNESS scale (channels scaled directly so a caller can pass a level
// it computed itself). The imu_debug motion visual.
void renderIdleBrightness(uint8_t brightness) {
  if (brightness > LED_BRIGHTNESS) brightness = LED_BRIGHTNESS;
  strip.setBrightness(LED_BRIGHTNESS);
  uint32_t color = strip.Color(
      (uint16_t)IDLE_FILL_R * brightness / LED_BRIGHTNESS,
      (uint16_t)IDLE_FILL_G * brightness / LED_BRIGHTNESS,
      (uint16_t)IDLE_FILL_B * brightness / LED_BRIGHTNESS);
  for (uint16_t i = 0; i < LED_COUNT; i++) {
    strip.setPixelColor(i, color);
  }
  strip.show();
}

}  // namespace Firewalker
