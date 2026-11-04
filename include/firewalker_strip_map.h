#pragma once

// Pure strip-geometry math — Arduino-free, like firewalker_fusion.h, so the
// host-native tests (test/test_strip_map/) can exercise it off-hardware.
//
// The strip is a closed ring around the foot perimeter: pixel 0 starts directly
// under the controller, and the indices run around the foot and return to the start
// (the last pixel sits adjacent to pixel 0). Each controller saves its own
// StripLayout: how many pixels the ring has, and which of them sit at the toe apex and
// the heel. A remote sets these on the worn boot (docs/remote-protocol.md), so the ring
// can run either way around: toe before heel, or heel before toe on a mirrored boot.
//
// Two arcs connect toe and heel, each named by the direction its indices climb:
//   - toe to heel: toe, toe+1, ... up to the heel
//   - heel to toe: heel, heel+1, ... up to the toe
// Whichever of them crosses the end of the strip wraps from the last pixel to pixel 0.
//
// Patterns that move along an arc work in *unwrapped* coordinates — each arc is
// treated as the contiguous index range starting at its first marker, such as
// [heel .. heel + heelToToeLen] — and only fold back into real pixel indices when
// painting (stripWrapIndex).

#include <stdint.h>

namespace Firewalker {

struct StripLayout {
  uint16_t count;  // pixels in the ring; any past this stay dark
  uint16_t toe;    // the pixel at the toe apex
  uint16_t heel;   // the pixel at the heel
};

// Toe and heel each need a pixel of their own.
constexpr uint16_t STRIP_MIN_PIXELS = 2;

// Length (in steps) of the arc whose indices climb from the toe to the heel.
constexpr uint16_t stripToeToHeelLen(uint16_t count, uint16_t toe, uint16_t heel) {
  return (uint16_t)((heel + count - toe) % count);
}

// Length (in steps) of the arc whose indices climb from the heel to the toe.
constexpr uint16_t stripHeelToToeLen(uint16_t count, uint16_t toe, uint16_t heel) {
  return (uint16_t)(count - stripToeToHeelLen(count, toe, heel));
}

// Fold an unwrapped (possibly >= count) position back to a real pixel index.
constexpr uint16_t stripWrapIndex(uint16_t p, uint16_t count) {
  return (uint16_t)(p % count);
}

// Fore-aft foot position s ∈ [0,1] of pixel i: heel = 0, toe = 1, linear in
// pixel steps along whichever arc the pixel sits on. Expects a valid layout, so both
// arcs have nonzero length.
inline float stripForeAft(uint16_t i, uint16_t count, uint16_t toe, uint16_t heel) {
  const uint16_t toeToHeel = stripToeToHeelLen(count, toe, heel);
  const uint16_t stepsFromToe = (uint16_t)((i + count - toe) % count);
  if (stepsFromToe <= toeToHeel) {
    // s falls 1→0 as the index climbs from toe to heel.
    return (float)(toeToHeel - stepsFromToe) / (float)toeToHeel;
  }
  // s climbs 0→1 as the index climbs from heel to toe.
  const uint16_t stepsFromHeel = (uint16_t)((i + count - heel) % count);
  return (float)stepsFromHeel / (float)stripHeelToToeLen(count, toe, heel);
}

// Whether a layout can be drawn. Also guards what comes back from flash, so a damaged
// record can't reach the division in stripForeAft.
constexpr bool stripLayoutValid(const StripLayout& layout, uint16_t maxPixels) {
  return layout.count >= STRIP_MIN_PIXELS && layout.count <= maxPixels &&
         layout.toe < layout.count && layout.heel < layout.count && layout.toe != layout.heel;
}

enum class StripField : uint8_t { Count, Toe, Heel };

// Changes one value of a layout. Returns nullptr on success, or the protocol's reason
// for rejecting it, which leaves the layout untouched.
//
// Changing the count never fails over the markers. A strip cut shorter than the heel's
// pixel would otherwise have to be set in a precise order, so a marker past the new end
// moves to the end instead, keeping its side of the other marker and its own pixel.
// Example: {count 160, toe 52, heel 132} with a count of 110 gives heel 109, and with a
// count of 20 gives toe 18 and heel 19.
inline const char* applyStripSetting(StripLayout& layout, StripField field, int32_t value,
                                     uint16_t maxPixels) {
  switch (field) {
    case StripField::Count: {
      if (value < STRIP_MIN_PIXELS || value > maxPixels) return "out-of-range";
      layout.count = (uint16_t)value;
      uint16_t& first = (layout.toe < layout.heel) ? layout.toe : layout.heel;
      uint16_t& last = (layout.toe < layout.heel) ? layout.heel : layout.toe;
      if (last >= layout.count) last = layout.count - 1;
      if (first >= last) first = last - 1;
      return nullptr;
    }
    case StripField::Toe:
    case StripField::Heel: {
      uint16_t& moved = (field == StripField::Toe) ? layout.toe : layout.heel;
      const uint16_t other = (field == StripField::Toe) ? layout.heel : layout.toe;
      if (value < 0 || value >= layout.count) return "out-of-range";
      if ((uint16_t)value == other) return "same-pixel";
      moved = (uint16_t)value;
      return nullptr;
    }
  }
  return "out-of-range";
}

}  // namespace Firewalker
