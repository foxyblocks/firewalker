/**
 * The slosh signal: where imaginary water sits in a tray strapped along the boot, from -1
 * (thrown to the heel) through 0 (level) to +1 (thrown to the toe). Recipes read it through
 * the `slosh` and `sloshAmount` sources.
 *
 * This file is the simulator's copy of the model. The boot's copy is
 * include/firewalker_slosh.h, fed by the motion sensor in src/firewalker_imu.cpp, and the
 * numbers in SLOSH mirror the SLOSH_* settings in include/config.h. Keep the two in step:
 * the simulator is only a fair preview while both sides run the same water.
 *
 * The water is a weight on a spring. Two things pull on it, both counted in g and both
 * positive toward the toe:
 *   - push: the boot's own speeding up and slowing down. Speeding up leaves the water
 *     behind at the heel (negative), and stopping throws it forward to the toe (positive).
 *   - pour: gravity along the foot. Toe down is positive, and it pulls more gently than a
 *     push, so walking reads as slosh and not as a second tilt.
 * The spring then overshoots and settles, which is what makes it look like water and not
 * like a slider. simulation.ts owns where the pushes come from: the walking gait and the
 * Push button.
 */

export const SLOSH = {
  // How fast the water rocks back and forth once disturbed, in cycles per second.
  frequencyHz: 1.6,
  // How quickly the rocking dies out. 1 would settle with no overshoot at all.
  damping: 0.35,
  // How far one g of push throws the water, before the soft limit.
  pushGain: 1.5,
  // How far one g of gravity along the foot pours it.
  pourGain: 0.6,
  // The pull the model accepts, in the same units as its position. A heel strike is a spike
  // of many g, and without a ceiling one hard step would pin the water for seconds.
  maxPull: 2.5,
  // The longest time one step may cover, in seconds. A stalled frame counts as this much.
  maxStepSeconds: 0.05,
} as const;

export interface SloshState {
  // Where the water is before the soft limit. Around -1..1 in normal use.
  position: number;
  // How fast it is moving, in position units per second.
  velocity: number;
}

export function newSloshState(): SloshState {
  return { position: 0, velocity: 0 };
}

/**
 * Moves the water forward by `seconds` and returns the slosh signal, -1..1.
 *
 * `pushG` and `pourG` are the two pulls described at the top of this file, in g, positive
 * toward the toe. The return value passes through a soft limit, so a hard shove eases up to
 * the end of the boot instead of slamming into it and sticking there.
 */
export function sloshStep(state: SloshState, pushG: number, pourG: number, seconds: number): number {
  const dt = Math.min(SLOSH.maxStepSeconds, Math.max(0, seconds));
  const wanted = SLOSH.pushGain * pushG + SLOSH.pourGain * pourG;
  const pull = Number.isFinite(wanted) ? Math.max(-SLOSH.maxPull, Math.min(SLOSH.maxPull, wanted)) : 0;

  // A spring pulling the water toward `pull`, with friction. Velocity updates first and the
  // position uses the new velocity, which keeps the spring stable at the boot's frame rate.
  const omega = 2 * Math.PI * SLOSH.frequencyHz;
  const acceleration = omega * omega * (pull - state.position) - 2 * SLOSH.damping * omega * state.velocity;
  state.velocity += acceleration * dt;
  state.position += state.velocity * dt;
  // Overshoot can carry the water past the ceiling. Stop it there so it can't wind up.
  if (Math.abs(state.position) > SLOSH.maxPull) {
    state.position = Math.sign(state.position) * SLOSH.maxPull;
    state.velocity = 0;
  }
  return Math.tanh(state.position);
}
