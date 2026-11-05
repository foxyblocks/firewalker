// recipe_budget measures what recipes cost on a real board, so the recipe format's limits can be set
// before version 1 freezes (specs/recipe-engine-spec.md, "Budgets on the board"). It runs each recipe
// in generated/recipe_budget.h for a few seconds on the real strip, with the Bluetooth stack running,
// and logs one line per recipe over USB. Then it logs memory use and stops.
//
//   bun run budget-recipes                 # in designer/
//   pio run -e recipe_budget -t upload --upload-port <usb serial>
//   pio device monitor
//
// It reads motion but changes no settings, so a boot's saved settings survive it.

#if defined(FIREWALKER_MODE_RECIPE_BUDGET)

#include "modes/recipe_budget.h"

#include <Arduino.h>
#include <math.h>

#include "FreeRTOS.h"
#include "config.h"
#include "firewalker_core.h"
#include "firewalker_imu.h"
#include "firewalker_recipe_engine.h"
#include "firewalker_remote.h"
#include "sl_memory_manager.h"
#include "task.h"

#if !__has_include("generated/recipe_budget.h")
#error "Run `bun run budget-recipes` in designer/ first."
#endif
#include "generated/recipe_budget.h"

namespace RecipeBudgetMode {

using namespace Firewalker;

static constexpr unsigned long CASE_MS = 6000;
// A stomp as often as the firmware can detect one, so stomp-driven layers work their hardest.
static constexpr unsigned long STOMP_EVERY_MS = 300;
static constexpr float STOMP_STRENGTH = 0.8f;
static constexpr float TILT_PERIOD_MS = 2600.0f;

static Recipe recipe;
static RecipeEngine<STRIP_MAX_PIXELS> engine;
static bool done = false;

struct Timing {
  uint32_t count = 0;
  uint64_t total = 0;
  uint32_t most = 0;

  void add(uint32_t us) {
    count++;
    total += us;
    if (us > most) most = us;
  }

  uint32_t average() const { return count ? (uint32_t)(total / count) : 0; }
};

static void printTiming(const __FlashStringHelper* name, const Timing& timing) {
  Serial.print(' ');
  Serial.print(name);
  Serial.print(F("_avg_us="));
  Serial.print(timing.average());
  Serial.print(' ');
  Serial.print(name);
  Serial.print(F("_max_us="));
  Serial.print(timing.most);
}

// Runs one recipe the way final_app's loop does: motion every pass, and a frame at most every
// APP_FRAME_MS. The tilt is scripted so every run sees the same motion.
static void runCase(const BudgetCase& budgetCase) {
  const RecipeDecodeResult decoded = decodeRecipe(budgetCase.bytes, budgetCase.size, recipe);
  if (decoded != RecipeDecodeResult::Ok) {
    Serial.print(F("[budget] decode failed: "));
    Serial.println((int)decoded);
    return;
  }

  const StripLayout layout = {budgetCase.count, budgetCase.toe, budgetCase.heel};
  setStripLayout(layout);
  engine.start(&recipe, layout);

  Timing engineTime;
  Timing showTime;
  Timing motionTime;
  Timing frameGap;
  const unsigned long start = millis();
  unsigned long lastFrame = start;
  unsigned long lastFrameUs = micros();
  unsigned long lastStomp = start;
  while (millis() - start < CASE_MS) {
    const uint32_t motionStart = micros();
    imuUpdate();
    imuTakeStomp();
    motionTime.add(micros() - motionStart);

    const unsigned long now = millis();
    if (now - lastFrame < APP_FRAME_MS) continue;

    const bool stomp = now - lastStomp >= STOMP_EVERY_MS;
    if (stomp) lastStomp = now;
    const float tilt = sinf(2.0f * (float)M_PI * (float)(now - start) / TILT_PERIOD_MS);

    const uint32_t frameStart = micros();
    frameGap.add(frameStart - lastFrameUs);
    lastFrameUs = frameStart;
    engine.update(fabsf(tilt) < 0.05f ? 0.0f : tilt, stomp, STOMP_STRENGTH, now - lastFrame);
    for (uint16_t i = 0; i < layout.count; i++) {
      strip.setPixelColor(i, engine.frameByte(i, 0), engine.frameByte(i, 1), engine.frameByte(i, 2));
    }
    const uint32_t showStart = micros();
    engineTime.add(showStart - frameStart);
    strip.show();
    showTime.add(micros() - showStart);
    lastFrame = now;
  }

  Serial.print(F("[budget] "));
  Serial.print(recipe.name);
  Serial.print(F(" bytes="));
  Serial.print(budgetCase.size);
  Serial.print(F(" px="));
  Serial.print(layout.count);
  Serial.print(F(" fps="));
  Serial.print((float)engineTime.count * 1000.0f / (float)CASE_MS, 1);
  printTiming(F("engine"), engineTime);
  printTiming(F("show"), showTime);
  printTiming(F("motion"), motionTime);
  printTiming(F("gap"), frameGap);
  Serial.println();
}

void setup() {
  setupCore(F("recipe_budget"));
  imuBegin();
  remoteBegin();
  strip.setBrightness(LED_BRIGHTNESS);
  // Time for a monitor to attach after an upload.
  delay(3000);
}

void loop() {
  if (done) {
    delay(1000);
    return;
  }
  done = true;

  Serial.print(F("[budget] cpu_hz="));
  Serial.print(SystemCoreClock);
  Serial.print(F(" brightness="));
  Serial.print(strip.brightness());
  Serial.print(F(" engine_bytes="));
  Serial.print(sizeof(engine));
  Serial.print(F(" recipe_bytes="));
  Serial.println(sizeof(recipe));

  for (const BudgetCase& budgetCase : BUDGET_CASES) {
    runCase(budgetCase);
    remoteUpdate();
  }

  strip.clear();
  strip.show();
  Serial.print(F("[budget] free_heap="));
  Serial.print(sl_memory_get_free_heap_size());
  Serial.print(F(" stack_spare_bytes="));
  Serial.println((unsigned long)uxTaskGetStackHighWaterMark(nullptr) * sizeof(StackType_t));
  Serial.println(F("[budget] done"));
}

}  // namespace RecipeBudgetMode

#endif  // FIREWALKER_MODE_RECIPE_BUDGET
