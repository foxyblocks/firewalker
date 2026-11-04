/**
 * A pretend boot in memory that speaks the real text protocol, failures included. It
 * stands in for hardware in the tests, in the iOS Simulator (which has no Bluetooth),
 * and in Chrome with `?boot=fake`.
 *
 * It mirrors the firmware's behavior rather than just its message formats, because
 * that's where the app's logic gets tested: status lines are rate limited, a burst of
 * changes becomes one flash write, replies split across 20-byte notifications, and a
 * capture takes two seconds and can fail. See src/modes/final_app.cpp on the firmware
 * side and docs/remote-protocol.md.
 */

import { AccessLostError, type BootLink, type FoundBoot, type LinkEvents, type RadioState, type Transport } from "./transport";
import type { Pose, StripSetting } from "../core/protocol";

const STATUS_MIN_MS = 250;
const MOTION_MS = 200;
const SAVE_QUIET_MS = 1000;
const SAVE_MAX_MS = 5000;
const CAPTURE_MS = 2000;
const REPLY_LATENCY_MS = 10;
const DEFAULT_FULL_TILT_DEG = 30;
const MAX_NEUTRAL_DEG = 45;
const MIN_POSE_RANGE_DEG = 10;
const NEUTRAL_DEAD_ZONE_DEG = 3;
const MIN_LEDS = 2;
const PREVIEW_HOLD_MS = 60000;

export interface FakeBootOptions {
  id?: string;
  /** The protocol version it reports. Older than the app's, it should be told to update. */
  proto?: number;
  /** What this boot can run. */
  patterns?: string[];
  pattern?: string;
  lastLit?: string;
  brightness?: number;
  maxBrightness?: number;
  sensor?: "ok" | "unavailable";
  calibrated?: boolean;
  neutralDeg?: number;
  heelDeg?: number | null;
  toeDeg?: number | null;
  debug?: boolean;
  saveFails?: boolean;
  leds?: number;
  maxLeds?: number;
  toe?: number;
  heel?: number;
  /** Angles a capture reads when nothing has set one, so demos give sensible results. */
  poseAngles?: Record<Pose, number>;
  /** Bytes per Bluetooth notification. The firmware's default MTU allows 20. */
  notificationBytes?: number;
  /** Rocks the boot slowly, so tilt visibly moves in demos. */
  wander?: boolean;
}

export class FakeBoot {
  readonly id: string;
  deviceId: string;
  readonly name: string;
  readonly proto: number;
  readonly availablePatterns: string[];

  /** Every command received, for tests to inspect. */
  readonly received: string[] = [];
  /** How many `identify` blinks it has shown. */
  blinks = 0;
  /** The browser can't reach this boot until it's picked again, as after a page reload. */
  accessLost = false;
  /** Set false to take the boot out of range. */
  reachable = true;
  /** Ignores all commands, as a boot with a stuck radio would. */
  unresponsive = false;
  /** Delays every reply, to hold a command in flight. */
  replyDelayMs = REPLY_LATENCY_MS;
  /** Skips the status line sent on subscribe. */
  silentOnSubscribe = false;
  /** Holds the boot still at this angle, overriding `poseAngles`. */
  angleDeg: number | null = null;
  /** The boot never settles, so a capture fails when its window ends. */
  moving = false;
  /** The next capture ends with no `calibrate` line, leaving only the status field. */
  silentCaptureResult = false;
  /** Sends a status holding the previous capture's result right after the ack. */
  staleStatusAfterAck = false;
  /** Commands it drops without answering, by first word. */
  ignoring: string[] = [];

  pattern: string;
  lastLit: string;
  brightness: number;
  readonly maxBrightness: number;
  sensor: "ok" | "unavailable";
  calibrated: boolean;
  neutralDeg: number;
  heelDeg: number | null;
  toeDeg: number | null;
  debug: boolean;
  saveFails: boolean;
  saves = 0;
  leds: number;
  readonly maxLeds: number;
  toe: number;
  heel: number;
  /** Whether the strip is showing its layout in place of its pattern. */
  preview = false;

  private events: LinkEvents | null = null;
  private readonly notificationBytes: number;
  private readonly poseAngles: Record<Pose, number>;
  private readonly wander: boolean;
  private calibration = "idle";
  private capturing = false;
  private saved = true;
  private saveFailed = false;
  private lastStatusAt = -Infinity;
  private firstUnsavedAt = 0;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private motionTimer: ReturnType<typeof setInterval> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: FakeBootOptions = {}) {
    this.id = options.id ?? "3ED1";
    this.deviceId = `fake-${this.id}`;
    this.name = `Firewalker-${this.id}`;
    this.proto = options.proto ?? 2;
    this.availablePatterns = options.patterns ?? ["flow", "fire-trail"];
    this.pattern = options.pattern ?? "flow";
    this.lastLit = options.lastLit ?? (this.pattern === "off" ? "flow" : this.pattern);
    this.brightness = options.brightness ?? 24;
    this.maxBrightness = options.maxBrightness ?? 64;
    this.sensor = options.sensor ?? "ok";
    this.calibrated = options.calibrated ?? false;
    this.neutralDeg = options.neutralDeg ?? 0;
    this.heelDeg = options.heelDeg ?? null;
    this.toeDeg = options.toeDeg ?? null;
    this.debug = options.debug ?? false;
    this.saveFails = options.saveFails ?? false;
    this.maxLeds = options.maxLeds ?? 160;
    this.leds = options.leds ?? this.maxLeds;
    this.toe = options.toe ?? 52;
    this.heel = options.heel ?? 132;
    this.notificationBytes = options.notificationBytes ?? 20;
    this.poseAngles = options.poseAngles ?? { neutral: 1.56, heel: -18.4, toe: 34.2 };
    this.wander = options.wander ?? false;
  }

  get connected(): boolean {
    return this.events !== null;
  }

  /** Connects a client. A boot holds one connection at a time. */
  attach(events: LinkEvents): void {
    this.events = events;
    this.startMotion();
    if (!this.silentOnSubscribe) this.queueStatus();
  }

  /** Ends the connection from the phone's side. The boot keeps running. */
  detach(): void {
    this.events = null;
    this.stopMotion();
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = null;
  }

  /** Ends the connection from the boot's side, as going out of range would. */
  dropLink(): void {
    const events = this.events;
    this.detach();
    events?.onClosed();
  }

  /** Handles one command, the way the firmware's handleCommand does. */
  receive(rawLine: string): void {
    const line = rawLine.trim();
    this.received.push(line);
    if (this.unresponsive) return;
    if (this.ignoring.includes(line.split(/\s+/)[0] ?? "")) return;

    const words = line.split(/\s+/);
    const verb = words[0] ?? "";
    const arg = words[1];

    switch (verb) {
      case "status":
        return this.sendStatus();
      case "patterns":
        return this.send(JSON.stringify({ t: "patterns", list: this.availablePatterns }));
      case "pattern":
        if (!arg) return this.ackInvalid("expected-one-argument");
        if (arg !== "off" && !this.availablePatterns.includes(arg)) {
          return this.ackInvalid("unknown-pattern");
        }
        this.select(arg);
        return this.ackThenStatus("pattern");
      case "power":
        if (arg !== "on" && arg !== "off") return this.ackInvalid("expected-on-or-off");
        this.select(arg === "on" ? this.lastLit : "off");
        return this.ackThenStatus("power");
      case "brightness": {
        const level = Number(arg);
        if (!Number.isInteger(level) || level < 0 || level > 255) {
          return this.ackInvalid("expected-0-to-255");
        }
        if (level < 1 || level > this.maxBrightness) {
          return this.send(JSON.stringify({ t: "ack", cmd: "brightness", ok: false, error: "out-of-range" }));
        }
        this.brightness = level;
        this.markChanged();
        return this.ackThenStatus("brightness");
      }
      case "calibrate":
        if (arg && arg !== "neutral" && arg !== "heel" && arg !== "toe") {
          return this.ackInvalid("unknown-pose");
        }
        return this.startCapture((arg as Pose | undefined) ?? "neutral");
      case "debug":
        if (arg !== "on" && arg !== "off") return this.ackInvalid("expected-on-or-off");
        this.debug = arg === "on";
        this.startMotion();
        return this.ackThenStatus("debug");
      case "identify":
        this.blinks++;
        return this.send(JSON.stringify({ t: "ack", cmd: "identify", ok: true }));
      case "strip":
        if (words.length !== 3) return this.ackInvalid("expected-setting-and-value");
        return arg === "preview" ? this.handlePreview(words[2]!) : this.handleStripSetting(arg!, words[2]!);
      default:
        return this.ackInvalid("unknown-command");
    }
  }

  /** Keeps a preview going for another minute, the way each strip command does on a boot. */
  private holdPreview(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null;
    if (!this.preview) return;
    this.previewTimer = setTimeout(() => {
      this.preview = false;
      this.queueStatus();
    }, PREVIEW_HOLD_MS);
  }

  private handlePreview(value: string): void {
    if (value !== "on" && value !== "off") return this.ackInvalid("expected-on-or-off");
    this.preview = value === "on";
    this.holdPreview();
    this.ackThenStatus("strip");
  }

  private handleStripSetting(setting: string, value: string): void {
    if (setting !== "leds" && setting !== "toe" && setting !== "heel") {
      return this.ackInvalid("unknown-strip-setting");
    }
    const pixel = Number(value);
    if (!Number.isInteger(pixel) || pixel < 0 || pixel > 65535) return this.ackInvalid("expected-number");

    const failure = this.applyStripSetting(setting, pixel);
    if (failure) return this.send(JSON.stringify({ t: "ack", cmd: "strip", ok: false, error: failure }));
    this.markChanged();
    this.holdPreview();
    this.ackThenStatus("strip");
  }

  /** The firmware's rules (applyStripSetting in firewalker_strip_map.h), failures included. */
  private applyStripSetting(setting: StripSetting, pixel: number): string | null {
    if (setting === "leds") {
      if (pixel < MIN_LEDS || pixel > this.maxLeds) return "out-of-range";
      this.leds = pixel;
      const toeFirst = this.toe < this.heel;
      const last = Math.min(toeFirst ? this.heel : this.toe, pixel - 1);
      const first = Math.min(toeFirst ? this.toe : this.heel, last - 1);
      this.toe = toeFirst ? first : last;
      this.heel = toeFirst ? last : first;
      return null;
    }
    if (pixel >= this.leds) return "out-of-range";
    if (pixel === (setting === "toe" ? this.heel : this.toe)) return "same-pixel";
    if (setting === "toe") this.toe = pixel;
    else this.heel = pixel;
    return null;
  }

  private select(pattern: string): void {
    if (pattern !== "off") this.lastLit = pattern;
    this.pattern = pattern;
    this.markChanged();
  }

  private ackThenStatus(cmd: string): void {
    this.send(JSON.stringify({ t: "ack", cmd, ok: true }));
    this.queueStatus();
  }

  private ackInvalid(error: string): void {
    this.send(JSON.stringify({ t: "ack", cmd: "unknown", ok: false, error }));
  }

  private currentAngle(pose: Pose): number {
    if (this.angleDeg !== null) return this.angleDeg;
    return this.poseAngles[pose];
  }

  private startCapture(pose: Pose): void {
    if (this.capturing) {
      return this.send(JSON.stringify({ t: "ack", cmd: "calibrate", ok: false, error: "already-capturing" }));
    }
    if (this.sensor !== "ok") {
      this.calibration = "sensor-unavailable";
      this.send(JSON.stringify({ t: "ack", cmd: "calibrate", ok: false, error: "sensor-unavailable" }));
      this.send(this.calibrateLine(pose, { state: "failed", reason: "sensor-unavailable" }));
      return this.queueStatus();
    }

    this.capturing = true;
    this.send(JSON.stringify({ t: "ack", cmd: "calibrate", ok: true }));
    if (this.staleStatusAfterAck) this.sendStatus();
    this.calibration = "capturing";
    this.send(this.calibrateLine(pose, { state: "capturing" }));
    this.queueStatus();

    setTimeout(() => this.finishCapture(pose), CAPTURE_MS);
  }

  private finishCapture(pose: Pose): void {
    this.capturing = false;
    const failure = this.captureFailure(pose);
    const silent = this.silentCaptureResult;
    this.silentCaptureResult = false;

    if (failure) {
      this.calibration = failure;
      if (!silent) this.send(this.calibrateLine(pose, { state: "failed", reason: failure }));
      return this.queueStatus();
    }

    const angle = this.currentAngle(pose);
    if (pose === "neutral") {
      this.resetPosesInvalidatedBy(angle);
      this.neutralDeg = angle;
      this.calibrated = true;
    } else if (pose === "heel") {
      this.heelDeg = angle;
    } else {
      this.toeDeg = angle;
    }
    this.calibration = "ok";
    this.saveNow();
    if (!silent) {
      this.send(
        this.calibrateLine(
          pose,
          { state: "ok", angleDeg: angle, tilt: this.tiltAt(angle) },
        ),
      );
    }
    this.queueStatus();
  }

  private captureFailure(pose: Pose): string | null {
    if (this.moving) return "motion";
    const angle = this.currentAngle(pose);
    if (pose === "neutral") return Math.abs(angle) > MAX_NEUTRAL_DEG ? "out-of-range" : null;
    if (Math.abs(angle - this.neutralDeg) < MIN_POSE_RANGE_DEG) return "too-close";
    const other = pose === "heel" ? this.toeDeg : this.heelDeg;
    if (other !== null && Math.sign(angle - this.neutralDeg) === Math.sign(other - this.neutralDeg)) {
      return "wrong-side";
    }
    return null;
  }

  /**
   * Retaking neutral keeps heel and toe, unless the new neutral lands past one of them
   * or within the minimum range of it. That side then returns to its default.
   */
  private resetPosesInvalidatedBy(newNeutral: number): void {
    const stillValid = (pose: number | null) =>
      pose !== null &&
      Math.sign(pose - newNeutral) === Math.sign(pose - this.neutralDeg) &&
      Math.abs(pose - newNeutral) >= MIN_POSE_RANGE_DEG;
    if (!stillValid(this.heelDeg)) this.heelDeg = null;
    if (!stillValid(this.toeDeg)) this.toeDeg = null;
  }

  /** Maps an angle to -1..+1 the way the firmware's three-point tilt does. */
  private tiltAt(angle: number): number {
    const toe = this.toeDeg ?? this.neutralDeg + DEFAULT_FULL_TILT_DEG;
    const heel = this.heelDeg ?? this.neutralDeg - DEFAULT_FULL_TILT_DEG;
    const offset = angle - this.neutralDeg;
    if (Math.abs(offset) <= NEUTRAL_DEAD_ZONE_DEG) return 0;
    const towardToe = Math.sign(offset) === Math.sign(toe - this.neutralDeg);
    const tilt = towardToe ? offset / (toe - this.neutralDeg) : -offset / (heel - this.neutralDeg);
    return Math.max(-1, Math.min(1, tilt));
  }

  /** The angle right now: held still, or slowly rocking in a demo. */
  private liveAngle(): number {
    if (this.angleDeg !== null) return this.angleDeg;
    if (!this.wander) return this.neutralDeg;
    return this.neutralDeg + Math.sin(Date.now() / 900) * 22;
  }

  private calibrateLine(pose: Pose, fields: Record<string, unknown>): string {
    return JSON.stringify({ t: "calibrate", pose, ...fields });
  }

  private markChanged(): void {
    const now = Date.now();
    if (this.saved) this.firstUnsavedAt = now;
    this.saved = false;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const quietDue = now + SAVE_QUIET_MS;
    const maxDue = this.firstUnsavedAt + SAVE_MAX_MS;
    this.saveTimer = setTimeout(() => this.saveNow(), Math.min(quietDue, maxDue) - now);
  }

  private saveNow(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.saveFailed = this.saveFails;
    this.saved = !this.saveFails;
    if (!this.saveFails) this.saves++;
    this.queueStatus();
  }

  /** Sends a status line no sooner than the firmware's rate limit allows. */
  private queueStatus(): void {
    if (this.statusTimer || !this.events) return;
    const wait = Math.max(0, this.lastStatusAt + STATUS_MIN_MS - Date.now());
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      this.sendStatus();
    }, wait);
  }

  private sendStatus(): void {
    this.lastStatusAt = Date.now();
    this.send(
      JSON.stringify({
        t: "status",
        proto: this.proto,
        lit: this.lastLit,
        heelDeg: this.heelDeg,
        toeDeg: this.toeDeg,
        id: this.id,
        pattern: this.pattern,
        brightness: this.brightness,
        maxBrightness: this.maxBrightness,
        sensor: this.sensor,
        tilt: round2(this.sensor === "ok" ? this.tiltAt(this.liveAngle()) : 0),
        calibrated: this.calibrated,
        neutralDeg: round2(this.neutralDeg),
        calibration: this.calibration,
        saved: this.saved,
        saveFailed: this.saveFailed,
        saves: this.saves,
        debug: this.debug,
        ble: true,
        leds: this.leds,
        maxLeds: this.maxLeds,
        toe: this.toe,
        heel: this.heel,
        preview: this.preview,
      }),
    );
  }

  private startMotion(): void {
    this.stopMotion();
    if (!this.debug || !this.events) return;
    this.motionTimer = setInterval(() => this.sendMotion(), MOTION_MS);
  }

  private stopMotion(): void {
    if (this.motionTimer) clearInterval(this.motionTimer);
    this.motionTimer = null;
  }

  private sendMotion(): void {
    const angle = this.liveAngle();
    const accel = 9.81 + Math.abs(Math.sin(Date.now() / 300)) * 2;
    this.send(
      JSON.stringify({
        t: "motion",
        tilt: round2(this.tiltAt(angle)),
        angleDeg: round2(angle),
        accel: round2(accel),
        accelPeak: round2(accel + 1.4),
        gyro: 0.03,
        stomp: false,
        strength: 0,
      }),
    );
  }

  /** Delivers one line, split into notifications the way the radio would split it. */
  private send(line: string): void {
    const text = `${line}\n`;
    const delay = this.replyDelayMs;
    for (let start = 0; start < text.length; start += this.notificationBytes) {
      const chunk = text.slice(start, start + this.notificationBytes);
      setTimeout(() => this.events?.onData(chunk), delay);
    }
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Implements the Transport seam over a set of pretend boots. */
export class FakeTransport implements Transport {
  readonly simulated = true;
  finding: "scan" | "picker";
  radio: RadioState = "on";
  /** How long a connection takes, during which the boot's first replies can already arrive. */
  openDelayMs = 0;
  private readonly boots: FakeBoot[];
  private scanTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(boots: FakeBoot[], finding: "scan" | "picker" = "scan") {
    this.boots = boots;
    this.finding = finding;
  }

  async radioState(): Promise<RadioState> {
    return this.radio;
  }

  async openSettings(): Promise<void> {}

  async startScan(onFound: (boot: FoundBoot) => void): Promise<void> {
    // A connected boot stops advertising, so it doesn't show up, same as real ones.
    this.scanTimer = setTimeout(() => {
      this.boots
        .filter((boot) => boot.reachable && !boot.connected)
        .forEach((boot, index) => {
          onFound({ deviceId: boot.deviceId, name: boot.name, rssi: index === 0 ? -48 : -67 });
        });
    }, 300);
  }

  async stopScan(): Promise<void> {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = null;
  }

  async pick(): Promise<FoundBoot | null> {
    const boot = this.boots.find((candidate) => candidate.reachable && !candidate.connected);
    if (!boot) return null;
    // A browser that can't remember boots grants access again under a new handle.
    if (boot.accessLost) {
      boot.accessLost = false;
      boot.deviceId = `${boot.deviceId}-again`;
    }
    return { deviceId: boot.deviceId, name: boot.name };
  }

  async open(deviceId: string, events: LinkEvents): Promise<BootLink> {
    const boot = this.boots.find((candidate) => candidate.deviceId === deviceId);
    if (boot?.accessLost) throw new AccessLostError();
    if (!boot || !boot.reachable || boot.connected) throw new Error("Boot not reachable");
    boot.attach(events);
    if (this.openDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.openDelayMs));
    return {
      write: async (line) => {
        if (!boot.connected) throw new Error("Not connected");
        boot.receive(line);
      },
      close: async () => boot.detach(),
    };
  }
}
