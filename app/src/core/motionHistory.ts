/**
 * A bounded diagnostic history for one connection. BootClient records each wire
 * report here before React renders, so a burst of notifications cannot hide a
 * stomp between two renders. Times are receipt times; each peak/stomp describes
 * the interval covered by that report, not a raw high-frequency sensor sample.
 */
import type { MotionReply } from "./protocol";

export const MOTION_HISTORY_MS = 15_000;
const MAX_POINTS = 150;

export interface MotionHistoryPoint {
  time: number;
  peak: number;
  stomp: boolean;
}

export function appendMotion(history: readonly MotionHistoryPoint[], motion: MotionReply, time: number): readonly MotionHistoryPoint[] {
  const peak = Number.isFinite(motion.accelPeak) ? motion.accelPeak : motion.accel;
  if (!Number.isFinite(peak) || peak < 0) return history;
  const recent = history.filter((point) => point.time >= time - MOTION_HISTORY_MS && point.time <= time);
  return [...recent.slice(-(MAX_POINTS - 1)), { time, peak, stomp: motion.stomp === true }];
}
