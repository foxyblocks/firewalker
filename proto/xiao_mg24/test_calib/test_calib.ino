// Low-brightness WS2812 wiring and timing test for USB-powered bring-up.
//
// Drives the configured test pixels on D10 (PA5), independently of the motion sensor and
// Firewalker patterns. Sends black to the rest of the connected 160-pixel strip
// on every frame so it cannot retain colors from an earlier demo. After
// reporting the measured clock on the onboard LED, cycles white/red/green/blue
// at TEST_LEVEL intensity. This limits requested brightness, not current;
// all connected pixel controllers still draw power while showing black.
// PlatformIO's strip_off environment uses this same driver to send only black
// frames and skips the clock-report blinks and color cycle.
//
// The driver measures the real core frequency using DWT cycles across a
// 100 ms millis() window; clock-derived timing can be incorrect on this core.
// Startup blinks report roughly MHz / 10 (4 blinks ~= 39 MHz, 8 ~= 78 MHz).
// If the strip stays dark, check power, common ground, input-end wiring, and
// data signal level as well as timing. D10 outputs 3.3V logic.
#include <Arduino.h>

static constexpr int STRIP_PIXELS = 160;
static constexpr int TEST_PIXELS = 160;
static constexpr uint8_t TEST_LEVEL = 16;  // 0–255 per active color channel
static const auto WS_PORT = gpioPortA;     // D10 = PA5
static const uint32_t WS_MASK = (1u << 5);

static uint32_t cycT0H, cycT1H, cycPeriod;

static inline void wsHigh() { BUS_RegMaskedSet(&GPIO->P[WS_PORT].DOUT, WS_MASK); }
static inline void wsLow() { BUS_RegMaskedClear(&GPIO->P[WS_PORT].DOUT, WS_MASK); }

// Anchor before selecting the pulse width and raising D10, matching the shared
// strip driver. Moving the timer read after the HIGH write lengthens the pulse
// on the wire and can corrupt even all-black frames. Keep both implementations
// aligned when changing timing. The compiler barrier keeps pulse-width loads
// inside the measured interval; upload verification cannot check the waveform.
static inline void wsByte(uint8_t b) {
  for (uint8_t i = 0; i < 8; i++) {
    const uint32_t t0 = DWT->CYCCNT;
    __asm__ __volatile__("" ::: "memory");
    const uint32_t th = (b & 0x80) ? cycT1H : cycT0H;
    wsHigh();
    while ((DWT->CYCCNT - t0) < th) {
    }
    wsLow();
    while ((DWT->CYCCNT - t0) < cycPeriod) {
    }
    b <<= 1;
  }
}

// Color only the test pixels at the strip's input end. Transmit a complete
// frame including black for every remaining pixel, so previous stored colors
// cannot leave the rest lit. Call after setup calibrates the pulse timings.
static void wsShow(uint8_t r, uint8_t g, uint8_t b) {
  noInterrupts();
  for (int i = 0; i < STRIP_PIXELS; i++) {
    const bool active = i < TEST_PIXELS;
    wsByte(active ? g : 0);
    wsByte(active ? r : 0);
    wsByte(active ? b : 0);
  }
  interrupts();
  wsLow();
  delayMicroseconds(300);  // latch
}

static void blink(uint32_t n) {
  for (uint32_t i = 0; i < n; i++) {
    digitalWrite(LED_BUILTIN, LED_BUILTIN_ACTIVE);
    delay(150);
    digitalWrite(LED_BUILTIN, LED_BUILTIN_INACTIVE);
    delay(300);
  }
}

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(D10, OUTPUT);
  wsLow();

  CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
  DWT->CYCCNT = 0;
  DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;

  // Measure real cycles over a 100 ms wall-clock window.
  uint32_t m = millis();
  while (millis() == m) {
  }  // align to a ms edge
  m = millis();
  uint32_t c0 = DWT->CYCCNT;
  while (millis() - m < 100) {
  }
  uint32_t cyc = DWT->CYCCNT - c0;  // cycles in 100 ms

  // Bit timing from measured cycles (cyc is cycles per 100 ms = per 1e8 ns).
  cycT0H = (uint32_t)((uint64_t)cyc * 350ull / 100000000ull);    // 0.35 us
  cycT1H = (uint32_t)((uint64_t)cyc * 700ull / 100000000ull);    // 0.70 us
  cycPeriod = (uint32_t)((uint64_t)cyc * 1250ull / 100000000ull);  // 1.25 us

  // Clear every pixel before the clock-report blinks and color demo.
  wsShow(0, 0, 0);

#if defined(FIREWALKER_STRIP_OFF)
  // Leave the onboard indicator off as well; strip_off only blanks the strip.
  digitalWrite(LED_BUILTIN, LED_BUILTIN_INACTIVE);
  return;
#endif

  // Report measured clock: blinks ~= MHz / 10.
  uint32_t mhz = cyc / 100000;  // cyc/1e5 = MHz
  blink((mhz + 5) / 10);
  delay(1200);
}

void loop() {
#if defined(FIREWALKER_STRIP_OFF)
  // Repeat black frames so the strip stays blank after a separate power cycle.
  // This does not disconnect VBUS or remove the pixel controllers' idle draw.
  wsShow(0, 0, 0);
  delay(100);
#else
  digitalWrite(LED_BUILTIN, LED_BUILTIN_ACTIVE);
  wsShow(TEST_LEVEL, TEST_LEVEL, TEST_LEVEL);  // dim white
  delay(500);
  digitalWrite(LED_BUILTIN, LED_BUILTIN_INACTIVE);
  wsShow(TEST_LEVEL, 0, 0);  // red
  delay(500);
  wsShow(0, TEST_LEVEL, 0);  // green
  delay(500);
  wsShow(0, 0, TEST_LEVEL);  // blue
  delay(500);
#endif
}
