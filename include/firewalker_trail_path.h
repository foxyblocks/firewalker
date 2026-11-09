#pragma once

// Where fire-trail bands run on the strip ring, given which part of the boot is down. It's
// pure math with no Arduino in it, like firewalker_strip_map.h, so the host-native tests
// (test/test_trail_path/) can check it off-hardware. FireTrailPattern
// (src/patterns/fire_trail.cpp) picks an origin when a stomp lands and gets the route from
// here, and it owns the timing and the colors.
//
// A trail starts at the part of the boot that's down and runs along both sides of the foot
// to the opposite part:
//   - toe down: two fronts leave the toe, one per side, and meet at the heel
//   - heel down: two fronts leave the heel, one per side, and meet at the toe
//   - flat: each side starts from its midpoint, and sends one front to the toe and one to
//     the heel, so four fronts run outward
//
// Example, with 160 pixels, toe 52, and heel 132. A toe-down trail has one front on
// 52, 53, ... 132, and another on 52, 51, ... 0, 159, ... 132.

#include <stdint.h>

#include "firewalker_strip_map.h"

namespace Firewalker {

// The part of the boot a trail starts from.
enum class TrailOrigin : uint8_t { Heel, Middle, Toe };

// Picks the origin from the stomp's angle in degrees from the neutral pose, with toe-down
// positive (orientationDegrees). Anything within flatDeg either way counts as flat, because
// a foot is rarely level when it lands, and further than that picks the end that's down.
// Example: with a flatDeg of 8, an angle of -6 is flat and -9 is heel down.
constexpr TrailOrigin trailOriginFromTilt(float tiltDeg, float flatDeg) {
  return (tiltDeg > flatDeg) ? TrailOrigin::Toe
         : (tiltDeg < -flatDeg) ? TrailOrigin::Heel
                                : TrailOrigin::Middle;
}

// One band's route around the ring.
struct TrailFront {
  uint16_t start;   // the pixel where the band's head starts
  int8_t   dir;     // +1 when the pixel indices climb, -1 when they fall
  uint16_t length;  // steps from start to the far end of the route
};

constexpr uint8_t TRAIL_PATH_MAX_FRONTS = 4;

// All the fronts one stomp launches. They move together, one step at a time.
struct TrailPath {
  TrailFront fronts[TRAIL_PATH_MAX_FRONTS];
  uint8_t    frontCount;
  uint16_t   longest;  // the longest front's length, for knowing when the whole trail is done
};

// The pixel a front's head is on after `steps` steps, folded across the seam between the
// last pixel and pixel 0. Expects steps <= front.length, which is at most the ring's size.
constexpr uint16_t trailFrontPixel(const TrailFront& front, uint16_t steps, uint16_t count) {
  return stripWrapIndex((uint16_t)((front.dir > 0) ? front.start + steps
                                                   : front.start + count - steps),
                        count);
}

// The route for a stomp with this origin. Expects a valid layout. Fronts all travel at the
// same speed, so when one side of the foot has more pixels, its front arrives a little after
// the other. Toe and heel sit across the foot from each other, so the gap stays small.
inline TrailPath trailPath(const StripLayout& layout, TrailOrigin origin) {
  const uint16_t toeToHeel = stripToeToHeelLen(layout.count, layout.toe, layout.heel);
  const uint16_t heelToToe = stripHeelToToeLen(layout.count, layout.toe, layout.heel);

  TrailPath path{};
  if (origin == TrailOrigin::Middle) {
    // The midpoints of the two sides. A side with an odd length puts its extra step on the
    // way up, and a side one step long has nothing below its midpoint, so that front paints
    // only the pixel it starts on.
    const uint16_t toeSide = stripWrapIndex((uint16_t)(layout.toe + toeToHeel / 2), layout.count);
    const uint16_t heelSide = stripWrapIndex((uint16_t)(layout.heel + heelToToe / 2), layout.count);
    const uint16_t toeSideDown = toeToHeel / 2;
    const uint16_t toeSideUp = (uint16_t)(toeToHeel - toeSideDown);
    const uint16_t heelSideDown = heelToToe / 2;
    const uint16_t heelSideUp = (uint16_t)(heelToToe - heelSideDown);

    path.fronts[0] = {toeSide, -1, toeSideDown};    // back to the toe
    path.fronts[1] = {toeSide, +1, toeSideUp};      // on to the heel
    path.fronts[2] = {heelSide, -1, heelSideDown};  // back to the heel
    path.fronts[3] = {heelSide, +1, heelSideUp};    // on to the toe
    path.frontCount = 4;
    path.longest = (toeSideUp > heelSideUp) ? toeSideUp : heelSideUp;
    return path;
  }

  // From the toe, climbing indices follow the toe-to-heel side and falling indices run the
  // heel-to-toe side backward. From the heel, the two swap.
  const bool fromToe = (origin == TrailOrigin::Toe);
  const uint16_t start = fromToe ? layout.toe : layout.heel;
  path.fronts[0] = {start, +1, fromToe ? toeToHeel : heelToToe};
  path.fronts[1] = {start, -1, fromToe ? heelToToe : toeToHeel};
  path.frontCount = 2;
  path.longest = (toeToHeel > heelToToe) ? toeToHeel : heelToToe;
  return path;
}

}  // namespace Firewalker
