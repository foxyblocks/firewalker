#include "firewalker_core.h"

#include <Adafruit_NeoPixel.h>

#include "config.h"

namespace Firewalker {

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

static uint32_t trailColor[TRAIL_LEN];

struct Trail {
  int16_t head;
  bool    active;
};

static Trail         trails[MAX_TRAILS];
static uint8_t       activeCount = 0;
static unsigned long lastStepMs  = 0;
static int           latestFsrReading = 0;
static bool          fsrArmed = true;

static uint32_t fireColor(uint8_t d, uint8_t span) {
  if (span <= 1) return strip.Color(FIRE[0][0], FIRE[0][1], FIRE[0][2]);

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
  return strip.Color(r, g, b);
}

static void showBootPixel() {
  if (!BOOT_PIXEL_DEBUG || BOOT_PIXEL_INDEX >= LED_COUNT) return;

  strip.setPixelColor(
      BOOT_PIXEL_INDEX,
      strip.Color(BOOT_PIXEL_R, BOOT_PIXEL_G, BOOT_PIXEL_B));
  strip.show();
}

static uint8_t fsrBrightness(int reading) {
  int clamped = constrain(reading, FSR_ANALOG_MIN, FSR_ANALOG_MAX);
  if (clamped <= FSR_ANALOG_MIN) return FSR_IDLE_MIN_BRIGHTNESS;
  return map(clamped, FSR_ANALOG_MIN, FSR_ANALOG_MAX, FSR_IDLE_MIN_BRIGHTNESS, LED_BRIGHTNESS);
}

void setupCore(const __FlashStringHelper* modeName) {
  Serial.begin(SERIAL_BAUD);
  delay(200);

  pinMode(FSR_PIN, INPUT);
  if (DEBUG_BUTTON_ENABLED) pinMode(DEBUG_BUTTON_PIN, INPUT_PULLUP);

  for (uint8_t d = 0; d < TRAIL_LEN; d++) trailColor[d] = fireColor(d, TRAIL_LEN);

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
  Serial.print(F(" fsr pin="));
  Serial.print(FSR_PIN);
  Serial.print(F(" stomp threshold="));
  Serial.print(FSR_STOMP_THRESHOLD);
  Serial.print(F(" release threshold="));
  Serial.print(FSR_RELEASE_THRESHOLD);
  Serial.print(F(" debug button="));
  Serial.println(DEBUG_BUTTON_ENABLED ? DEBUG_BUTTON_PIN : -1);
}

bool sampleFsr() {
  static unsigned long lastSampleMs = 0;

  unsigned long now = millis();
  if ((now - lastSampleMs) < FSR_SAMPLE_MS) return false;
  lastSampleMs = now;

  latestFsrReading = analogRead(FSR_PIN);
  if (FSR_DEBUG) {
    Serial.print(F("[firewalker] fsr raw="));
    Serial.print(latestFsrReading);
    Serial.print(F(" force="));
    Serial.print(constrain(latestFsrReading, FSR_ANALOG_MIN, FSR_ANALOG_MAX) - FSR_ANALOG_MIN);
    Serial.print(F(" brightness="));
    Serial.print(fsrBrightness(latestFsrReading));
    Serial.print(F(" armed="));
    Serial.println(fsrArmed ? F("true") : F("false"));
  }

  return true;
}

bool fsrPressed() {
  if (fsrArmed && latestFsrReading >= FSR_STOMP_THRESHOLD) {
    fsrArmed = false;
    Serial.print(F("[firewalker] fsr stomp @"));
    Serial.println(latestFsrReading);
    return true;
  }

  if (!fsrArmed && latestFsrReading <= FSR_RELEASE_THRESHOLD) {
    fsrArmed = true;
    Serial.print(F("[firewalker] fsr release @"));
    Serial.println(latestFsrReading);
  }

  return false;
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
      Serial.print(F("[firewalker] debug button "));
      Serial.print(stable == LOW ? F("DOWN") : F("UP"));
      Serial.print(F(" @"));
      Serial.print(millis());
      Serial.println(F("ms"));
    }
    if (stable == LOW) return true;
  }

  return false;
}

void spawnTrail() {
  for (uint8_t i = 0; i < MAX_TRAILS; i++) {
    if (!trails[i].active) {
      if (activeCount == 0) lastStepMs = millis();
      trails[i].head = 0;
      trails[i].active = true;
      activeCount++;
      Serial.print(F("[firewalker] stomp -> trail ("));
      Serial.print(activeCount);
      Serial.println(F(" active)"));
      return;
    }
  }
  Serial.println(F("[firewalker] stomp ignored - MAX_TRAILS reached"));
}

void renderTrails() {
  strip.setBrightness(LED_BRIGHTNESS);
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

void advanceTrailsIfDue() {
  if (activeCount == 0 || (millis() - lastStepMs) < WIPE_STEP_MS) return;

  lastStepMs = millis();
  for (uint8_t i = 0; i < MAX_TRAILS; i++) {
    if (!trails[i].active) continue;
    trails[i].head++;
    int16_t bottom = trails[i].head - (TRAIL_LEN - 1);
    if (bottom >= (int16_t)LED_COUNT) {
      trails[i].active = false;
      activeCount--;
    }
  }
  renderTrails();
}

void renderFsrIdle() {
  if (!FSR_IDLE_VISUAL_DEBUG) return;

  uint8_t brightness = fsrBrightness(latestFsrReading);
  strip.setBrightness(LED_BRIGHTNESS);
  uint32_t color = strip.Color(
      (uint16_t)FSR_IDLE_YELLOW_R * brightness / LED_BRIGHTNESS,
      (uint16_t)FSR_IDLE_YELLOW_G * brightness / LED_BRIGHTNESS,
      (uint16_t)FSR_IDLE_YELLOW_B * brightness / LED_BRIGHTNESS);
  for (uint16_t i = 0; i < LED_COUNT; i++) {
    strip.setPixelColor(i, color);
  }
  strip.show();
}

bool hasActiveTrails() {
  return activeCount > 0;
}

}  // namespace Firewalker
