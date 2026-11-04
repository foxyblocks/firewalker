/**
 * The boot's text protocol as the app sees it: how to spell a command, and how to
 * read what comes back. The firmware's side of this contract is
 * docs/remote-protocol.md.
 *
 * A boot takes one short text command per Bluetooth write and answers with one JSON
 * object per line. A reply can span several notifications, so `LineSplitter` joins
 * them back into lines before `parseLine` reads them.
 *
 * This file is pure: no Bluetooth, no timers, no React. `boot.ts` builds the
 * connection behavior on top of it, and `fakeBoot.ts` speaks the same text.
 *
 * Fields marked "newer firmware" aren't on every boot yet, so they're optional and the
 * app checks for them before relying on them.
 */

// The Nordic UART Service UUIDs the firmware advertises and listens on.
export const BOOT_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const BOOT_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const BOOT_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
export const BOOT_NAME_PREFIX = "Firewalker-";

// Offered until a boot says what it has. Firmware without the `patterns` command has
// exactly these two, so the fallback is accurate rather than a guess.
export const DEFAULT_PATTERNS = ["flow", "fire-trail"];

export type Pose = "neutral" | "heel" | "toe";

export interface StatusReply {
  t: "status";
  id: string;
  pattern: string;
  brightness: number;
  maxBrightness: number;
  sensor: "ok" | "unavailable";
  tilt: number;
  calibrated: boolean;
  neutralDeg: number;
  calibration: string;
  saved: boolean;
  saveFailed: boolean;
  saves: number;
  debug: boolean;
  proto?: number; // newer firmware: which protocol this firmware speaks
  lit?: string; // newer firmware: the pattern `power on` brings back
  heelDeg?: number | null; // newer firmware: null until that pose is captured
  toeDeg?: number | null; // newer firmware: null until that pose is captured
}

export interface AckReply {
  t: "ack";
  cmd: string;
  ok: boolean;
  error?: string;
}

export interface CalibrateReply {
  t: "calibrate";
  state: "capturing" | "ok" | "failed";
  pose?: Pose; // newer firmware: missing means neutral
  neutralDeg?: number;
  angleDeg?: number; // newer firmware: the angle saved for this pose
  tilt?: number;
  reason?: string;
}

export interface MotionReply {
  t: "motion";
  tilt: number;
  angleDeg: number;
  accel: number;
  gyro: number;
  stomp: boolean;
  strength: number;
  accelPeak?: number; // newer firmware: highest acceleration since the previous line
}

export interface PatternsReply {
  t: "patterns";
  list: string[];
}

export type BootReply = StatusReply | AckReply | CalibrateReply | MotionReply | PatternsReply;

// Every command fits the 20-byte Bluetooth write the firmware promises, as long as
// pattern names stay at 12 characters or fewer.
export const commands = {
  status: () => "status",
  patterns: () => "patterns",
  pattern: (id: string) => `pattern ${id}`,
  power: (on: boolean) => `power ${on ? "on" : "off"}`,
  brightness: (level: number) => `brightness ${Math.round(level)}`,
  // Plain `calibrate` means neutral on every firmware, including builds from before
  // heel and toe existed, which reject `calibrate neutral`.
  calibrate: (pose: Pose) => (pose === "neutral" ? "calibrate" : `calibrate ${pose}`),
  debug: (on: boolean) => `debug ${on ? "on" : "off"}`,
  identify: () => "identify",
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads one line from a boot. Returns null for anything the app can't use, such as
 * the firmware's `[firewalker]` log lines, a reply type added after this build, or a
 * reply missing the fields its type guarantees. Unknown extra fields are fine, so
 * the firmware can add to the protocol without breaking installed apps.
 */
export function parseLine(line: string): BootReply | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObject(value)) return null;

  switch (value.t) {
    case "status":
      return typeof value.id === "string" &&
        typeof value.pattern === "string" &&
        typeof value.brightness === "number" &&
        typeof value.maxBrightness === "number"
        ? (value as unknown as StatusReply)
        : null;
    case "ack":
      return typeof value.cmd === "string" && typeof value.ok === "boolean"
        ? (value as unknown as AckReply)
        : null;
    case "calibrate":
      return typeof value.state === "string" ? (value as unknown as CalibrateReply) : null;
    case "motion":
      return typeof value.tilt === "number" ? (value as unknown as MotionReply) : null;
    case "patterns":
      return Array.isArray(value.list) ? (value as unknown as PatternsReply) : null;
    default:
      return null;
  }
}

/**
 * Joins Bluetooth notifications back into whole lines. One notification can hold part
 * of a line or several lines, depending on how much the radio could carry.
 */
export class LineSplitter {
  private partial = "";

  /** Adds received text and returns any lines it completed, without their newlines. */
  push(text: string): string[] {
    this.partial += text;
    const lines = this.partial.split("\n");
    this.partial = lines.pop() ?? "";
    return lines;
  }

  /** Forgets a half-received line, which can never complete after a reconnect. */
  reset(): void {
    this.partial = "";
  }
}
