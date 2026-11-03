#pragma once

// Pure strip-geometry math — Arduino-free, like firewalker_fusion.h, so the
// host-native tests (test/test_strip_map/) can exercise it off-hardware.
//
// The strip is a closed ring around the foot perimeter: pixel 0 starts directly
// under the controller, runs forward along one side to the toe apex, back along
// the other side to the heel, then returns to the start (the last pixel sits
// adjacent to pixel 0). Toe and heel indices are constants in config.h
// (STRIP_TOE_INDEX / STRIP_HEEL_INDEX).
//
// Two arcs connect toe and heel:
//   - the "plain" arc: ascending indices toe..heel
//   - the "wrap" arc: heel..count-1 then 0..toe, through the ring's index wrap
//
// Patterns that move along an arc work in *unwrapped* coordinates — the wrap
// arc is treated as the contiguous index range [heel .. heel + wrapArcLen] —
// and only fold back into real pixel indices when painting (stripWrapIndex).

#include <stdint.h>

namespace Firewalker {

// Length (in steps) of the toe→heel arc that ascends plain indices.
constexpr uint16_t stripPlainArcLen(uint16_t toe, uint16_t heel) {
  return heel - toe;
}

// Length (in steps) of the heel→toe arc that runs through the index wrap.
constexpr uint16_t stripWrapArcLen(uint16_t count, uint16_t toe, uint16_t heel) {
  return count - stripPlainArcLen(toe, heel);
}

// Fold an unwrapped (possibly >= count) position back to a real pixel index.
constexpr uint16_t stripWrapIndex(uint16_t p, uint16_t count) {
  return (uint16_t)(p % count);
}

// Fore-aft foot position s ∈ [0,1] of pixel i: heel = 0, toe = 1, linear in
// pixel steps along whichever arc the pixel sits on. Assumes toe < heel < count
// (config.h enforces this; both arcs then have nonzero length).
inline float stripForeAft(uint16_t i, uint16_t count, uint16_t toe, uint16_t heel) {
  if (i >= toe && i <= heel) {
    // Plain arc: s falls 1→0 as the index climbs from toe to heel.
    return (float)(heel - i) / (float)stripPlainArcLen(toe, heel);
  }
  // Wrap arc: distance from the heel travelling up through the wrap.
  uint16_t d = (uint16_t)((i + count - heel) % count);
  return (float)d / (float)stripWrapArcLen(count, toe, heel);
}

}  // namespace Firewalker
