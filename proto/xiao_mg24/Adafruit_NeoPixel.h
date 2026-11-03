#pragma once
//
// Adafruit_NeoPixel compat shim for the Seeed XIAO MG24 (Silicon Labs EFR32MG24
// / "gecko" Arduino core).
//
// Why this exists: the board-agnostic Firewalker `flow` pattern is written
// against the Adafruit_NeoPixel API (the `strip` object plus the static
// ColorHSV()/Color() helpers). The real Adafruit_NeoPixel library does NOT
// support the gecko core (its show() hits "#error Architecture not supported").
// So rather than fork the pattern, this header is a drop-in `Adafruit_NeoPixel`
// implementing just the subset the pattern (and firewalker_core.h) use, backed
// by a small built-in WS2812 GPIO driver. With the real library uninstalled and
// this directory on the include path, `#include <Adafruit_NeoPixel.h>` resolves
// here.
//
// The WS2812 driver is bit-banged on the data pad and self-calibrates its bit
// timing to the REAL CPU clock, measured once in begin() by counting DWT cycles
// across a 100 ms millis() window. This is deliberate: the bundled ezWS2812gpio
// (and any getCPUClock()-derived timing) produces a dark strip on this board,
// because getCPUClock() misreports the core frequency — the high-pulses come out
// too short and every bit reads as 0. Measuring against millis() (which the core
// keeps accurate regardless of CPU clock) is robust. The 8-bit output loop is
// also correct (full brightness), unlike ezWS2812gpio's LSB-dropping loop.

#include <Arduino.h>
#include <stdlib.h>
#include <string.h>

// Strip-type flags accepted for source compatibility with the Adafruit API.
// The backend is fixed to WS2812 (GRB, 800 kHz), so these are not interpreted.
typedef uint16_t neoPixelType;
#ifndef NEO_GRB
#define NEO_KHZ800 0x0000
#define NEO_KHZ400 0x0000
#define NEO_GRB 0x0052
#define NEO_RGB 0x0006
#define NEO_RGBW 0x0000
#endif

class Adafruit_NeoPixel {
 public:
  Adafruit_NeoPixel(uint16_t n, int16_t pin,
                    neoPixelType type = NEO_GRB + NEO_KHZ800)
      : numLEDs_(n), pin_(pin) {
    (void)type;
  }

  // Allocate the buffer, set the data pad to output, enable the DWT cycle
  // counter, and calibrate WS2812 bit timing to the measured CPU clock. Must run
  // from setup() (after the core's static init), not at global-ctor time.
  void begin() {
    if (!buf_) buf_ = (uint8_t*)calloc((size_t)numLEDs_ * 3, 1);

    pinMode(pin_, OUTPUT);  // configures the pad as a push-pull output
    low_();

    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CYCCNT = 0;
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;

    // Measure real cycles over a 100 ms wall-clock window (cyc = cycles / 1e8 ns).
    uint32_t m = millis();
    while (millis() == m) {
    }
    m = millis();
    uint32_t c0 = DWT->CYCCNT;
    while (millis() - m < 100) {
    }
    uint32_t cyc = DWT->CYCCNT - c0;
    cycT0H_ = (uint32_t)((uint64_t)cyc * 350ull / 100000000ull);     // 0.35 us
    cycT1H_ = (uint32_t)((uint64_t)cyc * 700ull / 100000000ull);     // 0.70 us
    cycPeriod_ = (uint32_t)((uint64_t)cyc * 1250ull / 100000000ull);  // 1.25 us

    began_ = true;
  }

  void setBrightness(uint8_t b) { brightness_ = b; }
  uint16_t numPixels() const { return numLEDs_; }

  void clear() {
    if (buf_) memset(buf_, 0, (size_t)numLEDs_ * 3);
  }

  // Color packed 0x00RRGGBB (Adafruit convention). Stored raw; the global
  // brightness is applied at show() time.
  void setPixelColor(uint16_t n, uint32_t c) {
    if (n >= numLEDs_ || !buf_) return;
    uint8_t* p = &buf_[(size_t)n * 3];
    p[0] = (uint8_t)(c >> 16);  // R
    p[1] = (uint8_t)(c >> 8);   // G
    p[2] = (uint8_t)c;          // B
  }

  void setPixelColor(uint16_t n, uint8_t r, uint8_t g, uint8_t b) {
    if (n >= numLEDs_ || !buf_) return;
    uint8_t* p = &buf_[(size_t)n * 3];
    p[0] = r;
    p[1] = g;
    p[2] = b;
  }

  void fill(uint32_t c = 0) {
    for (uint16_t i = 0; i < numLEDs_; i++) setPixelColor(i, c);
  }

  // Stream the buffer out (GRB, MSB-first). Interrupts off across the frame so an
  // ISR can't stretch a bit's high-time and corrupt it.
  void show() {
    if (!buf_ || !began_) return;
    noInterrupts();
    for (uint16_t i = 0; i < numLEDs_; i++) {
      uint8_t* p = &buf_[(size_t)i * 3];
      sendByte_(scale_(p[1]));  // G
      sendByte_(scale_(p[0]));  // R
      sendByte_(scale_(p[2]));  // B
    }
    interrupts();
    low_();
    delayMicroseconds(300);  // latch
  }

  static uint32_t Color(uint8_t r, uint8_t g, uint8_t b) {
    return ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
  }

  // HSV -> packed 0x00RRGGBB. Verbatim from Adafruit_NeoPixel so colors match the
  // Feather build exactly (no gamma; pure HSV).
  static uint32_t ColorHSV(uint16_t hue, uint8_t sat = 255, uint8_t val = 255) {
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
    uint32_t v1 = 1 + val;
    uint16_t s1 = 1 + sat;
    uint8_t s2 = 255 - sat;
    return ((((((r * s1) >> 8) + s2) * v1) & 0xff00) << 8) |
           (((((g * s1) >> 8) + s2) * v1) & 0xff00) |
           (((((b * s1) >> 8) + s2) * v1) >> 8);
  }

 private:
  // Apply the global brightness to one channel (Adafruit-style (c*(b+1))>>8).
  uint8_t scale_(uint8_t c) const {
    return (brightness_ == 255)
               ? c
               : (uint8_t)(((uint16_t)c * (uint16_t)(brightness_ + 1)) >> 8);
  }

  // The strip data output is fixed to D10 = PA5. Keep these direct writes
  // aligned with the constructor pin in src/xiao_strip.cpp: pinMode() configures
  // that Arduino pin, while these writes send each timed pulse to port A bit 5.
  // Explicit port/bit selection keeps the timing loop independent of Arduino
  // pin-number encoding. The diagnostic test_calib sketch uses the same pad.
  inline void high_() { BUS_RegMaskedSet(&GPIO->P[gpioPortA].DOUT, (1u << 5)); }
  inline void low_() { BUS_RegMaskedClear(&GPIO->P[gpioPortA].DOUT, (1u << 5)); }

  // Send one byte, MSB-first. Anchor each bit before selecting its pulse width
  // and raising D10. The cycle counts include that preparation and GPIO access
  // time: moving the anchor after the HIGH write adds those costs to the pulse
  // on the wire, which can make a zero look like a one. The compiler barrier
  // also keeps the timing-field loads after the counter read: volatile DWT
  // access alone does not prevent ordinary member loads from moving earlier.
  // The barrier emits no instructions; it preserves this measured interval.
  inline void sendByte_(uint8_t b) {
    for (uint8_t i = 0; i < 8; i++) {
      const uint32_t t0 = DWT->CYCCNT;
      __asm__ __volatile__("" ::: "memory");
      const uint32_t th = (b & 0x80) ? cycT1H_ : cycT0H_;
      high_();
      while ((DWT->CYCCNT - t0) < th) {
      }
      low_();
      while ((DWT->CYCCNT - t0) < cycPeriod_) {
      }
      b <<= 1;
    }
  }

  uint16_t numLEDs_;
  int16_t pin_;
  uint8_t* buf_ = nullptr;
  uint8_t brightness_ = 255;
  bool began_ = false;

  uint32_t cycT0H_ = 0, cycT1H_ = 0, cycPeriod_ = 0;
};
