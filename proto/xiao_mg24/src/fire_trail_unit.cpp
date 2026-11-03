// Compiles the real fire-trail pattern (src/patterns/fire_trail.cpp) into the
// XIAO sketch without forking it, same mechanism as flow_unit.cpp. The repo's
// src/ and include/ dirs are on the include path (see build.sh), so fire_trail
// and its includes (config.h FIRE_*, firewalker_core.h, the Adafruit_NeoPixel
// shim) all resolve.
#include "patterns/fire_trail.cpp"
