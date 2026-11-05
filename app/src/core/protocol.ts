/**
 * The boot's text protocol as the app sees it: how to spell a command, and how to
 * read what comes back. The firmware's side of this contract is
 * docs/remote-protocol.md.
 *
 * A boot takes one short text command per Bluetooth write or USB line, and answers with one
 * JSON object per line. A reply can arrive in several pieces, so `LineSplitter` joins them
 * back into lines before `parseLine` reads them.
 *
 * This file is pure: no Bluetooth, no timers, no React. `boot.ts` builds the
 * connection behavior on top of it, and `fakeBoot.ts` speaks the same text.
 *
 * The app only supports firmware speaking PROTOCOL_VERSION or newer. A boot on anything
 * older gets a message asking you to update it, rather than a degraded experience.
 */

// The Nordic UART Service UUIDs the firmware advertises and listens on.
export const BOOT_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const BOOT_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const BOOT_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
export const BOOT_NAME_PREFIX = "Firewalker-";

/** The oldest firmware protocol this app works with. */
export const PROTOCOL_VERSION = 2;
/** Firmware that supports saved microphone tuning. Other controls work on older boots. */
export const AUDIO_PROTOCOL_VERSION = 4;

export type Pose = "neutral" | "heel" | "toe";

/** The strip layout values a boot saves: its pixel count, and the pixels at the toe and heel. */
export type StripSetting = "leds" | "toe" | "heel";

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
  proto?: number; // missing on firmware too old for this app
  lit: string; // the pattern `power on` brings back
  heelDeg: number | null; // null until that pose is captured
  toeDeg: number | null; // null until that pose is captured
  leds: number; // how many pixels the boot's ring has
  maxLeds: number; // the longest strip this build can drive
  toe: number; // the pixel at the toe
  heel: number; // the pixel at the heel
  preview: boolean; // the strip is showing its layout in place of its pattern
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
  pose: Pose;
  angleDeg?: number; // the angle saved for this pose, when state is "ok"
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
  accelPeak: number; // highest acceleration since the previous line
}

export interface PatternsReply {
  t: "patterns";
  list: string[];
}

export interface AudioConfigReply {
  t: "audio-config";
  ready: boolean;
  noiseFloor: number;
  sensitivity: number;
  calibrating: boolean;
  saved: boolean;
}

export type BootReply = AudioConfigReply | StatusReply | AckReply | CalibrateReply | MotionReply | PatternsReply;

// Every command fits the 20-byte Bluetooth write the firmware promises, as long as
// pattern names stay at 12 characters or fewer.
export const commands = {
  status: () => "status",
  audio: () => "audio",
  audioGain: (value: number) => `audio gain ${Math.round(value)}`,
  audioCalibrate: () => "audio calibrate",
  patterns: () => "patterns",
  pattern: (id: string) => `pattern ${id}`,
  power: (on: boolean) => `power ${on ? "on" : "off"}`,
  brightness: (level: number) => `brightness ${Math.round(level)}`,
  calibrate: (pose: Pose) => `calibrate ${pose}`,
  debug: (on: boolean) => `debug ${on ? "on" : "off"}`,
  identify: () => "identify",
  strip: (setting: StripSetting, value: number) => `strip ${setting} ${Math.round(value)}`,
  stripPreview: (on: boolean) => `strip preview ${on ? "on" : "off"}`,
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
    case "audio-config":
      return typeof value.ready === "boolean" && typeof value.calibrating === "boolean" &&
        typeof value.saved === "boolean" && typeof value.noiseFloor === "number" &&
        typeof value.sensitivity === "number" && Number.isInteger(value.sensitivity) &&
        value.sensitivity >= 0 && value.sensitivity <= 100
        ? (value as unknown as AudioConfigReply) : null;
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
 * Joins received text back into whole lines. One Bluetooth notification or USB read can hold
 * part of a line or several lines, depending on how much arrived at once.
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
