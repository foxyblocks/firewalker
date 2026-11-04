/**
 * The app's connection to one boot: keeping the link up, sending commands, and holding
 * the last thing the boot reported. There's one BootClient per boot, and each has its
 * own queue and timers, so one boot can never affect the other. `boots.ts` owns the
 * pair and decides which of them a tap goes to.
 *
 * The boot is the source of truth. A tap sets a `pending` value, which the UI shows
 * until a status line settles it, so a control can never claim something the boot
 * didn't do. If a command fails, the pending value goes away and the control returns
 * to the last reported value.
 *
 * Text goes through the `Transport` seam (transport/transport.ts), so everything here
 * runs the same against a real boot and against `fakeBoot.ts`.
 */

import {
  commands,
  LineSplitter,
  parseLine,
  type BootReply,
  type CalibrateReply,
  type MotionReply,
  type Pose,
  type StatusReply,
  type StripSetting,
} from "./protocol";
import type { BootLink, Transport } from "../transport/transport";

const COMMAND_TIMEOUT_MS = 2000;
const FIRST_STATUS_WAIT_MS = 2000;
// A new link this quiet is dead even though it opened, so it gets dropped and retried.
const FIRST_STATUS_MAX_ASKS = 3;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15000;
// A capture collects for two seconds, so anything past this means a lost result.
const CAPTURE_RESULT_WAIT_MS = 4000;
// A boot drops a strip preview a minute after the last strip command, so asking well inside
// that keeps it up, and a phone that goes away can't leave a boot stuck on it.
const PREVIEW_REFRESH_MS = 20000;
// These follow a finger, so a status line mustn't move them mid-drag.
const SLIDER_FIELDS: ReadonlySet<keyof Pending> = new Set(["brightness", "leds", "toe", "heel"]);

export type LinkState = "idle" | "connecting" | "online" | "reconnecting";

export interface Pending {
  pattern?: string;
  power?: boolean;
  brightness?: number;
  debug?: boolean;
  leds?: number;
  toe?: number;
  heel?: number;
  preview?: boolean;
}

export type CaptureResult =
  | { ok: true; pose: Pose; angleDeg: number }
  | { ok: false; pose: Pose; reason: string };

export interface BootState {
  link: LinkState;
  /** The latest status line. Survives a dropped link, so the UI can show what it knew. */
  status?: StatusReply;
  /** The latest motion line, while debug is on. */
  motion?: MotionReply;
  /** The patterns this boot can run. */
  patterns: string[];
  /** The values tapped but not yet confirmed. */
  pending: Pending;
  /** The capture in progress. */
  capture?: { pose: Pose };
  /** Why the last command failed: a firmware error code, or "no-answer". */
  notice?: string;
}

// `field` ties a command to the pending value it settles. `expect` says which reply
// ends it: most commands ack, but `status` and `patterns` answer with their own line.
interface Job {
  line: () => string;
  field?: keyof Pending;
  expect: "ack" | "status" | "patterns";
  /** Quiet jobs fail without showing the person a notice. */
  quiet?: boolean;
  onFail?: (reason: string) => void;
  onAck?: () => void;
}

export class BootClient {
  private state: BootState = { link: "idle", patterns: [], pending: {} };
  private readonly listeners = new Set<() => void>();
  private readonly splitter = new LineSplitter();

  private link: BootLink | null = null;
  private wanted = false;
  /** True while a connection attempt is running. A boot only gets one at a time. */
  private opening = false;
  private wantDebug = false;
  private dragging = false;
  private desiredBrightness = 0;
  private readonly desiredStrip: Record<StripSetting, number> = { leds: 0, toe: 0, heel: 0 };
  private wantPreview = false;
  private reconnectDelay = RECONNECT_MIN_MS;
  /** Bumped per connection, so a stale attempt can't touch the current one. */
  private generation = 0;

  private queue: Job[] = [];
  private inFlight: Job | null = null;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private firstStatusTimer: ReturnType<typeof setTimeout> | null = null;
  private firstStatusAsks = 0;
  private commandTimer: ReturnType<typeof setTimeout> | null = null;
  private previewTimer: ReturnType<typeof setInterval> | null = null;

  private capture: {
    pose: Pose;
    acked: boolean;
    resolve: (result: CaptureResult) => void;
    timer: ReturnType<typeof setTimeout> | null;
    askedStatus: boolean;
  } | null = null;

  constructor(
    private readonly transport: Transport,
    readonly deviceId: string,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A stable snapshot for React. It's replaced, never mutated, on every change. */
  getState = (): BootState => this.state;

  private update(changes: Partial<BootState>): void {
    this.state = { ...this.state, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  // ── Connection ─────────────────────────────────────────────────────────

  /** Starts connecting, and keeps the boot connected until `disconnect`. */
  connect(): void {
    this.wanted = true;
    if (this.link || this.opening) return;
    this.update({ link: this.state.status ? "reconnecting" : "connecting" });
    void this.attempt();
  }

  /** Ends the connection on purpose. The boot keeps running what it's running. */
  async disconnect(): Promise<void> {
    this.wanted = false;
    this.generation++;
    this.clearReconnect();
    this.stopPreviewRefresh();
    this.wantPreview = false;
    const link = this.link;
    this.teardown();
    this.update({ link: "idle" });
    await link?.close().catch(() => undefined);
  }

  /**
   * Call when the app returns to the foreground. iOS can drop links in the background
   * and the boot's state may have moved on, so this re-reads status or reconnects now
   * instead of waiting out the backoff.
   */
  resume(): void {
    if (!this.wanted) return;
    if (this.state.link === "online") {
      this.requestStatus();
    } else if (!this.link && !this.opening) {
      this.clearReconnect();
      this.reconnectDelay = RECONNECT_MIN_MS;
      void this.attempt();
    }
  }

  /**
   * Opens one connection. Only one runs at a time, because a second one would share the
   * same device, and closing either would drop both. A boot's first status line can arrive
   * before the connection finishes opening, so this runs whatever that line queued. An
   * attempt that `disconnect` cancelled mid-way closes what it opened, and tries again if
   * `connect` has since been called.
   */
  private async attempt(): Promise<void> {
    this.opening = true;
    const generation = ++this.generation;
    this.splitter.reset();
    try {
      const link = await this.transport.open(this.deviceId, {
        onData: (text) => {
          if (generation === this.generation) this.onData(text);
        },
        onClosed: () => {
          if (generation === this.generation) this.onLinkLost();
        },
      });
      this.opening = false;
      if (generation !== this.generation) {
        await link.close().catch(() => undefined);
        if (this.wanted) this.scheduleReconnect();
        return;
      }
      this.link = link;
      if (this.state.link === "online") this.pump();
      else this.scheduleFirstStatusAsk();
    } catch {
      this.opening = false;
      if (this.wanted) this.scheduleReconnect();
    }
  }

  /**
   * A boot normally sends status on subscribe. This keeps asking in case that line got
   * lost, and gives up on a link that never answers, so a boot can't sit at "connecting"
   * forever over a dead connection.
   */
  private scheduleFirstStatusAsk(): void {
    this.firstStatusTimer = setTimeout(() => {
      if (this.firstStatusAsks++ >= FIRST_STATUS_MAX_ASKS) {
        const link = this.link;
        this.generation++;
        this.onLinkLost();
        void link?.close().catch(() => undefined);
        return;
      }
      this.askForStatus();
      this.scheduleFirstStatusAsk();
    }, FIRST_STATUS_WAIT_MS);
  }

  private onLinkLost(): void {
    this.teardown();
    if (this.wanted) {
      this.update({ link: "reconnecting" });
      this.scheduleReconnect();
    } else {
      this.update({ link: "idle" });
    }
  }

  private scheduleReconnect(): void {
    if (!this.wanted) return;
    this.clearReconnect();
    this.update({ link: "reconnecting" });
    this.reconnectTimer = setTimeout(() => void this.attempt(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /** Drops everything tied to the current link. Nothing queued survives a disconnect. */
  private teardown(): void {
    this.link = null;
    if (this.firstStatusTimer) clearTimeout(this.firstStatusTimer);
    this.firstStatusTimer = null;
    if (this.commandTimer) clearTimeout(this.commandTimer);
    this.commandTimer = null;
    this.inFlight = null;
    this.queue = [];
    this.dragging = false;
    this.firstStatusAsks = 0;
    this.finishCapture({ reason: "offline" });
    this.update({ pending: {}, motion: undefined });
  }

  // ── Replies ────────────────────────────────────────────────────────────

  private onData(text: string): void {
    for (const line of this.splitter.push(text)) {
      const reply = parseLine(line);
      if (reply) this.onReply(reply);
    }
  }

  private onReply(reply: BootReply): void {
    switch (reply.t) {
      case "status":
        return this.onStatus(reply);
      case "motion":
        return this.update({ motion: reply });
      case "calibrate":
        return this.onCalibrate(reply);
      case "patterns":
        this.update({ patterns: reply.list });
        if (this.inFlight?.expect === "patterns") this.finishJob();
        return;
      case "ack":
        // Acks name a command but carry no request ID, so one arriving after its command
        // timed out mustn't settle whichever command came next. The firmware reports
        // anything it can't parse as "unknown".
        if (!this.inFlight || (reply.cmd !== "unknown" && reply.cmd !== jobVerb(this.inFlight))) return;
        if (reply.ok) {
          this.inFlight?.onAck?.();
          this.finishJob();
        } else {
          this.failJob(reply.error ?? "failed");
        }
        return;
    }
  }

  /**
   * Takes in a status line. It's the source of truth, so it settles pending taps and shows
   * the boot is alive again. The first one on a new connection is what makes a boot
   * online, and it starts the pattern list request and the debug cleanup.
   */
  private onStatus(status: StatusReply): void {
    const firstSinceConnecting = this.state.link !== "online";
    if (this.firstStatusTimer) clearTimeout(this.firstStatusTimer);
    this.firstStatusTimer = null;
    this.firstStatusAsks = 0;

    this.update({
      status,
      link: "online",
      notice: this.state.notice === "no-answer" ? undefined : this.state.notice,
      motion: status.debug ? this.state.motion : undefined,
      pending: this.settlePending(),
    });

    // A reconnect may follow a firmware update, so the list is worth refreshing. An empty
    // list means the last request went unanswered, so this also retries that. A boot whose
    // request goes unanswered keeps the list it has.
    if (firstSinceConnecting || this.state.patterns.length === 0) this.askForPatterns();
    if (firstSinceConnecting) {
      this.reconnectDelay = RECONNECT_MIN_MS;
      // Debug stays on after a disconnect, so clean up after an earlier session.
      if (status.debug && !this.wantDebug) this.setDebug(false);
      // Bring back a preview the connection dropped, or clear one left by an earlier session.
      if (this.wantPreview || status.preview) this.sendPreview();
    }

    if (this.inFlight?.expect === "status") this.finishJob();
    this.checkCaptureInStatus(status);
  }

  /**
   * Drops pending values a status line has answered. Status follows the ack, so once a
   * field has no command queued or in flight, the boot's report is final. A slider
   * mid-drag is the exception, so the thumb doesn't jump back under your finger.
   */
  private settlePending(): Pending {
    const pending = { ...this.state.pending };
    const busy = (field: keyof Pending) =>
      this.inFlight?.field === field || this.queue.some((job) => job.field === field);
    for (const field of Object.keys(pending) as (keyof Pending)[]) {
      if (!busy(field) && !(this.dragging && SLIDER_FIELDS.has(field))) delete pending[field];
    }
    return pending;
  }

  // ── Command queue ──────────────────────────────────────────────────────

  private enqueue(job: Job): void {
    this.queue.push(job);
    this.pump();
  }

  /**
   * Sends the next command if none is in flight. Acks name a command but carry no
   * request ID, so keeping one in flight is what makes each reply unambiguous. It also
   * protects the firmware's 8-slot queue, which silently drops overflow.
   */
  private pump(): void {
    if (this.inFlight || !this.link) return;
    const job = this.queue.shift();
    if (!job) return;
    this.inFlight = job;
    this.commandTimer = setTimeout(() => this.failJob("no-answer"), COMMAND_TIMEOUT_MS);
    this.link.write(job.line()).catch(() => {
      if (this.inFlight === job) this.failJob("no-answer");
    });
  }

  private finishJob(): void {
    if (this.commandTimer) clearTimeout(this.commandTimer);
    this.commandTimer = null;
    this.inFlight = null;
    this.pump();
  }

  private failJob(reason: string): void {
    const job = this.inFlight;
    if (!job) return;
    if (this.commandTimer) clearTimeout(this.commandTimer);
    this.commandTimer = null;
    this.inFlight = null;
    job.onFail?.(reason);
    if (job.field) this.clearPending(job.field);
    if (!job.quiet) this.update({ notice: reason });
    this.pump();
  }

  private clearPending(field: keyof Pending): void {
    const pending = { ...this.state.pending };
    delete pending[field];
    this.update({ pending });
  }

  private setPending(changes: Pending): void {
    this.update({ pending: { ...this.state.pending, ...changes }, notice: undefined });
  }

  private get online(): boolean {
    return this.state.link === "online";
  }

  private statusJob(): Job {
    return { line: commands.status, expect: "status", quiet: true };
  }

  // ── Controls ───────────────────────────────────────────────────────────

  setPattern(pattern: string): void {
    if (!this.online) return;
    this.setPending({ pattern, power: undefined });
    this.enqueue({ line: () => commands.pattern(pattern), field: "pattern", expect: "ack" });
  }

  setPower(on: boolean): void {
    if (!this.online) return;
    this.setPending({ power: on, pattern: undefined });
    this.enqueue({ line: () => commands.power(on), field: "power", expect: "ack" });
  }

  /**
   * Sets brightness, keeping only the newest value while a command is in flight. The
   * job reads the value when it's sent, so a whole drag can share one queue slot.
   */
  setBrightness(level: number): void {
    if (!this.online) return;
    this.desiredBrightness = level;
    this.setPending({ brightness: level });
    const alreadyQueued = this.queue.some((job) => job.field === "brightness");
    if (!alreadyQueued) {
      this.enqueue({
        line: () => commands.brightness(this.desiredBrightness),
        field: "brightness",
        expect: "ack",
      });
    }
  }

  /**
   * Sets one value of the strip layout. Like brightness, the job reads the value when it's
   * sent, so a whole drag shares one queue slot and the boot gets the latest position.
   */
  setStrip(setting: StripSetting, value: number): void {
    if (!this.online) return;
    this.desiredStrip[setting] = value;
    this.setPending({ [setting]: value });
    const alreadyQueued = this.queue.some((job) => job.field === setting);
    if (!alreadyQueued) {
      this.enqueue({
        line: () => commands.strip(setting, this.desiredStrip[setting]),
        field: setting,
        expect: "ack",
      });
    }
  }

  /**
   * Shows the strip's layout on the strip itself, in place of its pattern, while it's being
   * set. It stays up until turned off, through a dropped connection too, by asking again
   * before the boot's own limit runs out.
   */
  setStripPreview(on: boolean): void {
    this.wantPreview = on;
    this.stopPreviewRefresh();
    if (on) {
      this.previewTimer = setInterval(() => this.sendPreview(), PREVIEW_REFRESH_MS);
    }
    this.sendPreview();
  }

  private sendPreview(): void {
    if (!this.online) return;
    // Directly, rather than through setPending, so a refresh can't clear someone's notice.
    this.update({ pending: { ...this.state.pending, preview: this.wantPreview } });
    const alreadyQueued = this.queue.some((job) => job.field === "preview");
    if (!alreadyQueued) {
      this.enqueue({
        line: () => commands.stripPreview(this.wantPreview),
        field: "preview",
        expect: "ack",
        quiet: true,
      });
    }
  }

  private stopPreviewRefresh(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.previewTimer = null;
  }

  /** Tells the client a slider drag has started or ended. */
  setDragging(dragging: boolean): void {
    this.dragging = dragging;
    if (dragging || !this.online) return;
    // The drag's last value may already have been confirmed, with its status line gone
    // by. Asking again lets the pending value settle instead of sticking.
    this.requestStatus();
  }

  setDebug(on: boolean): void {
    this.wantDebug = on;
    if (!this.online) return;
    this.setPending({ debug: on });
    this.enqueue({ line: () => commands.debug(on), field: "debug", expect: "ack" });
  }

  /** Asks for a fresh status line, unless one is already on its way. */
  requestStatus(): void {
    if (this.online) this.askForStatus();
  }

  private askForPatterns(): void {
    const asked = this.inFlight?.expect === "patterns" || this.queue.some((job) => job.expect === "patterns");
    if (!asked) this.enqueue({ line: commands.patterns, expect: "patterns", quiet: true });
  }

  private askForStatus(): void {
    const asked = this.inFlight?.expect === "status" || this.queue.some((job) => job.expect === "status");
    if (!asked) this.enqueue(this.statusJob());
  }

  /**
   * Keeps tilt fresh for as long as something is on screen to show it. Status lines
   * only go out on a change, so the reading goes stale without asking. Returns the
   * function that stops it.
   */
  watchTilt(everyMs: number): () => void {
    const timer = setInterval(() => this.requestStatus(), everyMs);
    return () => clearInterval(timer);
  }

  /** Blinks the strip so you can tell which physical boot this is. It changes no settings. */
  blink(): void {
    if (this.online) this.enqueue({ line: commands.identify, expect: "ack" });
  }

  // ── Calibration ────────────────────────────────────────────────────────

  /**
   * Captures one pose, resolving when the boot reports the outcome. Normally that's an
   * ack refusing the capture, or a `calibrate` line. If neither arrives in time, it asks
   * for status and reads the `calibration` field, then gives up with "no-answer".
   */
  calibrate(pose: Pose): Promise<CaptureResult> {
    if (!this.online) return Promise.resolve({ ok: false, pose, reason: "offline" });
    if (this.capture) return Promise.resolve({ ok: false, pose, reason: "already-capturing" });

    return new Promise((resolve) => {
      this.capture = { pose, acked: false, resolve, timer: null, askedStatus: false };
      this.update({ capture: { pose }, notice: undefined });
      this.enqueue({
        line: () => commands.calibrate(pose),
        expect: "ack",
        quiet: true,
        onAck: () => this.onCaptureAcked(),
        onFail: (reason) => this.finishCapture({ reason }),
      });
    });
  }

  private onCaptureAcked(): void {
    if (!this.capture) return;
    this.capture.acked = true;
    this.capture.timer = setTimeout(() => this.onCaptureSilent(), CAPTURE_RESULT_WAIT_MS);
  }

  private onCaptureSilent(): void {
    const capture = this.capture;
    if (!capture) return;
    if (capture.askedStatus) {
      this.finishCapture({ reason: "no-answer" });
      return;
    }
    capture.askedStatus = true;
    this.requestStatus();
    capture.timer = setTimeout(() => this.onCaptureSilent(), COMMAND_TIMEOUT_MS);
  }

  private onCalibrate(reply: CalibrateReply): void {
    if (!this.capture) return;
    if (reply.state === "ok") {
      this.finishCapture({ angleDeg: reply.angleDeg ?? 0 });
    } else if (reply.state === "failed") {
      this.finishCapture({ reason: reply.reason ?? "failed" });
    }
  }

  /**
   * Picks up a lost result from a status line, but only one asked for after the wait. A
   * status arriving sooner may still hold the previous capture's result, which would
   * finish this capture while the boot is still collecting.
   */
  private checkCaptureInStatus(status: StatusReply): void {
    const capture = this.capture;
    if (!capture?.askedStatus) return;
    if (status.calibration === "capturing" || status.calibration === "idle") return;
    if (status.calibration === "ok") {
      this.finishCapture({ angleDeg: this.angleForPose(capture.pose, status) });
    } else {
      this.finishCapture({ reason: status.calibration });
    }
  }

  private angleForPose(pose: Pose, status: StatusReply): number {
    if (pose === "heel") return status.heelDeg ?? 0;
    if (pose === "toe") return status.toeDeg ?? 0;
    return status.neutralDeg;
  }

  private finishCapture(outcome: { angleDeg: number } | { reason: string }): void {
    const capture = this.capture;
    if (!capture) return;
    if (capture.timer) clearTimeout(capture.timer);
    this.capture = null;
    this.update({ capture: undefined });
    capture.resolve(
      "reason" in outcome
        ? { ok: false, pose: capture.pose, reason: outcome.reason }
        : { ok: true, pose: capture.pose, angleDeg: outcome.angleDeg },
    );
  }
}

/** The word a job's command starts with, which is what its ack names. */
function jobVerb(job: Job): string {
  return job.line().split(" ")[0] ?? "";
}
