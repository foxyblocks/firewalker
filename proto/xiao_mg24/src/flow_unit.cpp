// Compiles the real, board-agnostic flow pattern (src/patterns/flow.cpp) into
// the XIAO sketch without forking it. arduino-cli only compiles sources inside
// the sketch tree, so this wrapper pulls the upstream implementation in by
// include. The repo's src/ and include/ dirs are on the compile include path
// (see build.sh), so flow.cpp and all of its includes — config.h,
// firewalker_core.h, firewalker_strip_map.h, patterns/flow.h, and the
// Adafruit_NeoPixel compat shim — resolve. Edits to the upstream flow pattern
// flow straight through to this build.
#include "patterns/flow.cpp"
