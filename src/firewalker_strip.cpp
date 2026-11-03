// Bit-banged WS2812 output for the XIAO MG24. See firewalker_strip.h for the API.
//
// Bit timing comes from cycles counted against millis() in begin(). The core's
// getCPUClock() reports the wrong frequency here, which makes every high pulse too
// short and leaves the strip completely dark. millis() stays accurate, so the
// measured count is safe to derive pulse widths from.
#if !defined(FIREWALKER_ADAFRUIT_STRIP_API)

#include "firewalker_strip.h"

#include <stdlib.h>
#include <string.h>

#include "config.h"

namespace Firewalker {

// Direct port writes keep pulse timing independent of Arduino's pin lookups.
// PA5 is the D10 pad, so keep this aligned with LED_PIN in config.h.
static inline void dataHigh() { BUS_RegMaskedSet(&GPIO->P[gpioPortA].DOUT, 1u << 5); }
static inline void dataLow() { BUS_RegMaskedClear(&GPIO->P[gpioPortA].DOUT, 1u << 5); }

// Scales one channel the way Adafruit_NeoPixel does, so a brightness of 255 is
// an exact passthrough and every level below it can reach true black.
static inline uint8_t scaleChannel(uint8_t value, uint8_t brightness) {
  return (brightness == 255) ? value
                             : (uint8_t)(((uint16_t)value * (brightness + 1)) >> 8);
}

// Sends one byte, most significant bit first. Each bit's timer starts before the
// pulse width is chosen and before D10 goes high, so those steps count toward
// the pulse. Starting the timer after the high write stretches every pulse enough
// to turn zeros into ones, which corrupts even all-black frames. The compiler
// barrier stops the width loads from moving ahead of the timer read, which
// otherwise shows up as stray lit pixels. It emits no instructions.
static inline void sendByte(uint8_t value, uint32_t t0h, uint32_t t1h, uint32_t period) {
  for (uint8_t bit = 0; bit < 8; bit++) {
    const uint32_t start = DWT->CYCCNT;
    __asm__ __volatile__("" ::: "memory");
    const uint32_t high = (value & 0x80) ? t1h : t0h;
    dataHigh();
    while ((DWT->CYCCNT - start) < high) {
    }
    dataLow();
    while ((DWT->CYCCNT - start) < period) {
    }
    value <<= 1;
  }
}

void LedStrip::begin() {
  if (!pixels_) pixels_ = (uint8_t*)calloc((size_t)count_ * 3, 1);

  pinMode(LED_PIN, OUTPUT);
  dataLow();

  CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
  DWT->CYCCNT = 0;
  DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;

  // Count CPU cycles across 100 ms of wall-clock time, starting on a ms edge.
  uint32_t edge = millis();
  while (millis() == edge) {
  }
  edge = millis();
  const uint32_t startCycles = DWT->CYCCNT;
  while (millis() - edge < 100) {
  }
  const uint64_t cyclesPer100Ms = DWT->CYCCNT - startCycles;

  // 100 ms is 1e8 ns, so these convert nanoseconds to cycles.
  cyclesT0H_ = (uint32_t)(cyclesPer100Ms * STRIP_T0H_NS / 100000000ull);
  cyclesT1H_ = (uint32_t)(cyclesPer100Ms * STRIP_T1H_NS / 100000000ull);
  cyclesPeriod_ = (uint32_t)(cyclesPer100Ms * STRIP_BIT_PERIOD_NS / 100000000ull);
}

void LedStrip::clear() {
  if (pixels_) memset(pixels_, 0, (size_t)count_ * 3);
}

void LedStrip::setPixelColor(uint16_t index, uint32_t color) {
  setPixelColor(index, (uint8_t)(color >> 16), (uint8_t)(color >> 8), (uint8_t)color);
}

void LedStrip::setPixelColor(uint16_t index, uint8_t r, uint8_t g, uint8_t b) {
  if (index >= count_ || !pixels_) return;
  uint8_t* pixel = &pixels_[(size_t)index * 3];
  pixel[0] = r;
  pixel[1] = g;
  pixel[2] = b;
}

void LedStrip::show() {
  if (!pixels_ || cyclesPeriod_ == 0) return;
  // An interrupt during a pulse would stretch it and corrupt the frame.
  noInterrupts();
  for (uint16_t i = 0; i < count_; i++) {
    const uint8_t* pixel = &pixels_[(size_t)i * 3];
    sendByte(scaleChannel(pixel[1], brightness_), cyclesT0H_, cyclesT1H_, cyclesPeriod_);
    sendByte(scaleChannel(pixel[0], brightness_), cyclesT0H_, cyclesT1H_, cyclesPeriod_);
    sendByte(scaleChannel(pixel[2], brightness_), cyclesT0H_, cyclesT1H_, cyclesPeriod_);
  }
  interrupts();
  dataLow();
  delayMicroseconds(STRIP_LATCH_US);
}

uint32_t LedStrip::ColorHSV(uint16_t hue, uint8_t sat, uint8_t val) {
  uint8_t r, g, b;
  hue = (hue * 1530L + 32768) / 65536;
  if (hue < 510) {
    b = 0;
    if (hue < 255) {
      r = 255;
      g = hue;
    } else {
      r = 510 - hue;
      g = 255;
    }
  } else if (hue < 1020) {
    r = 0;
    if (hue < 765) {
      g = 255;
      b = hue - 510;
    } else {
      g = 1020 - hue;
      b = 255;
    }
  } else if (hue < 1530) {
    g = 0;
    if (hue < 1275) {
      r = hue - 1020;
      b = 255;
    } else {
      r = 255;
      b = 1530 - hue;
    }
  } else {
    r = 255;
    g = b = 0;
  }
  const uint32_t v1 = 1 + val;
  const uint16_t s1 = 1 + sat;
  const uint8_t s2 = 255 - sat;
  return ((((((r * s1) >> 8) + s2) * v1) & 0xff00) << 8) |
         (((((g * s1) >> 8) + s2) * v1) & 0xff00) |
         (((((b * s1) >> 8) + s2) * v1) >> 8);
}

}  // namespace Firewalker
#endif
