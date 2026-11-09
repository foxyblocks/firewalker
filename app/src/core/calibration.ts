/**
 * Labels and instructions for one boot's pose capture, and what a failed capture says. The
 * firmware does the capture and the tilt math (docs/remote-protocol.md), so this only
 * supplies wording to the per-boot configuration screen.
 */

import type { Pose } from "./protocol";

export const POSE_NAMES: Record<Pose, string> = {
  neutral: "Neutral",
  heel: "Heel down",
  toe: "Toe down",
};

export const POSE_INSTRUCTIONS: Record<Pose, string> = {
  neutral: "Stand with your weight even on a flat floor, and stay there. A little wobble is fine.",
  heel: "Heel on the floor, toes up, as far as you want the full effect. Stay there. A little wobble is fine.",
  toe: "Toes on the floor, heel up, as far as you want the full effect. Stay there. A little wobble is fine.",
};

const FAILURES: Record<string, string> = {
  motion: "It kept moving too much to find one pose. Settle into it and try again.",
  "no-samples": "The motion sensor stopped responding. Try again, then restart the boot.",
  "sensor-unavailable": "This boot's motion sensor isn't available, so it can't calibrate.",
  "out-of-range": "The boot couldn't use that sensor angle. Restart it and try again. Older firmware may need an update for a vertical mount.",
  "neutral-required": "Capture neutral first so the boot can learn its mounting angle.",
  "orientation-update-required": "Update this boot's firmware for 3D pose calibration. Then recapture neutral, heel and toe.",
  "off-axis": "That pose moved sideways from the learned heel-to-toe direction. Hold the boot steady and retake it.",
  "too-close": "That's too close to neutral. Tilt further and try again.",
  "wrong-side": "Heel and toe came out on the same side of neutral. Clear a saved heel or toe pose, then retake it.",
  "needs-update": "Update this boot's firmware to clear saved poses.",
  "save-failed": "The pose changed, but the boot couldn't save it. Keep it powered and try again.",
  "already-clearing": "It's still clearing the saved pose. Give it a second.",
  "no-answer": "The boot didn't answer. Check it's nearby and try again.",
  offline: "The boot isn't connected. Wait for it to reconnect and try again.",
  "already-capturing": "It's still capturing. Give it a second and try again.",
};

/** The message for a firmware failure reason, including ones newer than this build. */
export function failureMessage(reason: string): string {
  return FAILURES[reason] ?? `That didn't work (${reason}). Try again.`;
}
