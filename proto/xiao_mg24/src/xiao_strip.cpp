// Defines the single shared strip object the flow pattern draws to (declared
// `extern Adafruit_NeoPixel strip` in firewalker_core.h). On the XIAO MG24 the
// WS2812 data line is the D10 pad, and Adafruit_NeoPixel here is the bit-bang
// compat shim (proto/xiao_mg24/Adafruit_NeoPixel.h), not the real Adafruit
// library (unsupported on the gecko core).
//
// LED_COUNT comes from config.h, with build.sh supplying 160 pixels and virtual
// toe/heel positions for this bench demo. The pattern buffers use those same
// build flags, so all pixels participate in the tilt-controlled ring effect.
#include <Adafruit_NeoPixel.h>

#include "config.h"
#include "firewalker_core.h"

namespace Firewalker {

Adafruit_NeoPixel strip(LED_COUNT, D10, NEO_GRB + NEO_KHZ800);

}  // namespace Firewalker
