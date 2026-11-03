#pragma once

// LED strip driver for the BTF FCOB strip (XGB1338, WS2812B-compatible, GRB,
// 800 kHz) on the XIAO MG24's D10 pad. Patterns draw into a pixel buffer through
// `Firewalker::strip` (firewalker_core.h) and push it with show(). Brightness is
// applied at show() time, so changing it never loses the colors a pattern set.
// src/firewalker_strip.cpp explains how the signal is generated.
//
// The Feather build and the prototype sketch still use the Adafruit_NeoPixel API,
// so with FIREWALKER_ADAFRUIT_STRIP_API this header only aliases that class.

#include <Arduino.h>

#if defined(FIREWALKER_ADAFRUIT_STRIP_API)
#include <Adafruit_NeoPixel.h>
namespace Firewalker {
using LedStrip = Adafruit_NeoPixel;
}
#else

namespace Firewalker {

class LedStrip {
 public:
  explicit LedStrip(uint16_t pixelCount) : count_(pixelCount) {}

  // Allocates the frame buffers and starts the SPI hardware that drives D10. Call
  // from setup(), not at global-constructor time.
  void begin();

  // Global 0-255 scale applied to every channel at show() time.
  void setBrightness(uint8_t level) { brightness_ = level; }
  uint8_t brightness() const { return brightness_; }
  uint16_t numPixels() const { return count_; }

  // Blacks out the buffer. The strip keeps its old colors until show().
  void clear();
  // Colors are packed 0x00RRGGBB. Out-of-range indices are ignored.
  void setPixelColor(uint16_t index, uint32_t color);
  void setPixelColor(uint16_t index, uint8_t r, uint8_t g, uint8_t b);

  // Sends one whole frame, including black for unlit pixels, so a previous frame
  // can't stay lit on downstream pixels. Does nothing before begin(). Blocks the
  // calling task for about 30 us per pixel plus the latch, while interrupts and
  // higher-priority tasks such as the Bluetooth stack keep running.
  void show();

  static uint32_t Color(uint8_t r, uint8_t g, uint8_t b) {
    return ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
  }
  // HSV to packed RGB with no gamma, using Adafruit_NeoPixel's math so colors
  // match the look the patterns were tuned with. Hue spans the whole uint16 range.
  static uint32_t ColorHSV(uint16_t hue, uint8_t sat = 255, uint8_t val = 255);

 private:
  size_t encodedSize() const;

  uint16_t count_;
  uint8_t* pixels_ = nullptr;   // R, G, B per pixel, before brightness
  uint8_t* encoded_ = nullptr;  // the frame as SPI bytes, sent by DMA
  uint8_t brightness_ = 255;
};

}  // namespace Firewalker
#endif
