#pragma once

// The slosh signal: where imaginary water sits in a tray strapped along the boot, from -1
// (thrown to the heel) through 0 (level) to +1 (thrown to the toe). Recipes read it through
// the Slosh and SloshAmount sources, and charon-slosh is the built-in pattern made from it.
//
// The water is a weight on a spring. Two things pull on it, both counted in g and both
// positive toward the toe:
//   - push: the boot's own speeding up and slowing down. Moving off leaves the water
//     behind at the heel (negative), and stopping throws it forward to the toe (positive).
//   - pour: gravity along the foot. Toe down is positive, and it pulls more gently than a
//     push, so walking reads as slosh and not as a second tilt.
// The spring then overshoots and settles, which is what makes it look like water and not
// like a slider.
//
// This is the boot's copy of the model. The designer's simulator runs the same water in
// designer/src/sim/slosh.ts, and SLOSH_PARAMS in config.h mirrors the SLOSH numbers there.
// Keep the two in step: the simulator is only a fair preview while both run the same water.
//
// Pure and Arduino-free. src/firewalker_imu.cpp feeds it each motion sample and hands the
// result to patterns through imuSlosh(), and test/test_slosh runs it off-hardware.

#include <math.h>

#include "firewalker_orientation.h"

namespace Firewalker {

struct SloshParams {
  float frequencyHz;     // how fast the water rocks back and forth once disturbed, cycles per second
  float damping;         // how quickly the rocking dies out; 1 would settle with no overshoot
  float pushGain;        // how far one g of push throws the water, before the soft limit
  float pourGain;        // how far one g of gravity along the foot pours it
  float maxPull;         // the largest pull the water accepts, in the same units as its position
  float maxStepSeconds;  // the longest time one step may cover; a stalled loop counts as this much
};

struct SloshState {
  float position = 0.0f;  // where the water is before the soft limit, around -1..1 in normal use
  float velocity = 0.0f;  // how fast it is moving, in position units per second
};

// The two pulls on the water for one motion sample, in g, positive toward the toe.
struct SloshPull {
  float pushG = 0.0f;
  float pourG = 0.0f;
};

// Splits one motion sample into push and pour.
//
// `acceleration` is the sensor's reading in m/s^2, gravity included. `gravity` is the fused
// unit vector for what the sensor reads at rest (GravityFusion), and `gravityMagnitude` is
// that resting reading's size in m/s^2. Everything is in chip coordinates, so the chip can
// sit at any angle on the boot.
//
// The signs need no knowledge of how the chip is mounted. bootForward() is the direction
// the resting reading leans toward when the toe drops, which is when water runs to the
// toe. Water can't tell a tilt from a shove, so any reading along that direction sends it
// the same way: braking reads like a sudden toe-down tilt, and moving off like heel-down.
//
// An uncalibrated boot doesn't know which way its foot points, so it reports no pull and
// the water stays level, the same as tilt reading flat.
inline SloshPull sloshPull(Vec3 acceleration, Vec3 gravity, const OrientationCalibration& c,
                           float gravityMagnitude) {
  SloshPull pull;
  if (!orientationCalibrated(c) || !usableVector(gravity) || gravityMagnitude <= 0.0f) return pull;
  const Vec3 forward = bootForward(c);
  const Vec3 resting = unit(gravity);
  pull.pourG = dot(resting, forward);
  // What is left after removing the resting reading is the boot's own change of speed.
  pull.pushG = dot(acceleration - resting * gravityMagnitude, forward) / gravityMagnitude;
  return pull;
}

// Moves the water forward by `seconds` and returns the slosh signal, -1..1.
//
// The return value passes through a soft limit, so a hard shove eases up to the end of the
// boot instead of slamming into it and sticking there. A reading that isn't a number counts
// as no pull, so one bad sample can't poison the water for good.
inline float sloshStep(SloshState& state, float pushG, float pourG, float seconds, const SloshParams& p) {
  const float dt = isfinite(seconds) && seconds > 0.0f ? fminf(p.maxStepSeconds, seconds) : 0.0f;
  const float wanted = p.pushGain * pushG + p.pourGain * pourG;
  // A heel strike is a spike of many g. Without this ceiling one hard step would pin the
  // water at an end for seconds.
  const float pull = isfinite(wanted) ? fmaxf(-p.maxPull, fminf(p.maxPull, wanted)) : 0.0f;

  // A spring pulling the water toward `pull`, with friction. Velocity updates first and the
  // position uses the new velocity, which keeps the spring stable at the sensor's sample rate.
  const float omega = 6.28318531f * p.frequencyHz;
  const float acceleration = omega * omega * (pull - state.position) - 2.0f * p.damping * omega * state.velocity;
  state.velocity += acceleration * dt;
  state.position += state.velocity * dt;
  // Overshoot can carry the water past the ceiling. Stop it there so it can't wind up.
  if (fabsf(state.position) > p.maxPull) {
    state.position = copysignf(p.maxPull, state.position);
    state.velocity = 0.0f;
  }
  return tanhf(state.position);
}

}  // namespace Firewalker
