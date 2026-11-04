/**
 * What the Calibrate flow walks through, and what it says when a capture fails. The
 * firmware does the capture and the tilt math (docs/remote-protocol.md), so this only
 * decides the order of poses and the wording.
 */

import type { Side } from "./boots";
import type { Pose } from "./protocol";

export interface CalibrationStep {
  pose: Pose;
  sides: Side[];
}

/**
 * The poses to take for the chosen boots. Neutral goes first because the firmware
 * checks heel and toe against it. With two boots, neutral is captured together since
 * you're standing on both, then heel and toe go one boot at a time, which is steadier
 * than rocking back on both feet.
 */
export function calibrationSteps(sides: Side[], supportsPoses: (side: Side) => boolean): CalibrationStep[] {
  const steps: CalibrationStep[] = [{ pose: "neutral", sides }];
  for (const side of sides) {
    if (!supportsPoses(side)) continue;
    steps.push({ pose: "heel", sides: [side] }, { pose: "toe", sides: [side] });
  }
  return steps;
}

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
  "out-of-range": "It held still, but too far from level. Set it flatter and try again.",
  "too-close": "That's too close to neutral. Tilt further and try again.",
  "wrong-side": "Heel and toe came out on the same side of neutral. Retake them, starting with neutral.",
  "no-answer": "The boot didn't answer. Check it's nearby and try again.",
  offline: "The boot isn't connected. Wait for it to reconnect and try again.",
  "already-capturing": "It's still capturing. Give it a second and try again.",
};

/** The message for a firmware failure reason, including ones newer than this build. */
export function failureMessage(reason: string): string {
  return FAILURES[reason] ?? `That didn't work (${reason}). Try again.`;
}
