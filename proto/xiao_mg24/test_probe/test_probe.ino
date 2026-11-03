// DC probe for isolating the dark-strip fault. No WS2812 signalling — it just
// holds D10 (PA5) steady HIGH (3.3V) and lights the onboard LED solid, so the
// physical path can be checked with a multimeter:
//
//   * D10 pad -> GND            should read ~3.3V   (pin is driving)
//   * strip DIN (where wired)  should read ~3.3V   (data wire has continuity)
//   * strip V+ -> GND          should read ~5V     (strip is actually powered)
//   * XIAO 5V/VBUS pad -> GND  should read ~5V     (board is sourcing 5V)
//
// If V+ at the strip is not ~5V, it's a power-wiring problem (the strip can't
// light no matter what data it gets). If D10 reads ~3.3V but the strip's DIN does
// not, the data wire/contact is the problem.
#include <Arduino.h>

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LED_BUILTIN_ACTIVE);  // solid = probe build is live
  pinMode(D10, OUTPUT);
  digitalWrite(D10, HIGH);  // hold the data pad at logic high for measuring
}

void loop() {
  // hold steady
}
