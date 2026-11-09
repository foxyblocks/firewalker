/**
 * Reads for the UI that sit on top of a boot's state: which side a physical boot is on, and
 * the newer report fields a boot may or may not send. Firmware that predates a field leaves it
 * out, so each read says "unknown" rather than guessing.
 */

import type { BootState } from "../core/boot";
import type { BootsStore, Side } from "../core/boots";
import type { AudioSignalReply, StatusReply } from "../core/protocol";

/** The microphone signal a boot streams while its debug output is on, if it's sent any. */
export function audioSignalOf(state: BootState | undefined): AudioSignalReply | undefined {
  return state?.audioSignal;
}

/**
 * Whether the boot has neutral plus at least one side pose, which is what sets the foot's
 * axis. Undefined from firmware that doesn't report it.
 */
export function orientationCalibratedOf(status: StatusReply | undefined): boolean | undefined {
  return status?.orientationCalibrated;
}

/** The side a physical boot is labeled, looked up fresh so a swap is followed. */
export function sideOf(store: BootsStore, deviceId: string): Side | undefined {
  return store.sides().find((side) => store.known(side)?.deviceId === deviceId);
}

/** What a boot still needs calibrated, for a short hint. Undefined when nothing does. */
export function calibrationNeed(state: BootState | undefined): string | undefined {
  const status = state?.status;
  if (!status || state.link !== "online" || status.sensor !== "ok") return undefined;
  if (!status.calibrated) return "Neutral not set";
  if (orientationCalibratedOf(status) === false) return "Needs heel or toe";
  return undefined;
}
