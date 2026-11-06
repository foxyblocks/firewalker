/**
 * Human activity, separate from connection traffic. The remote's BootsStore and
 * designer's BootConnections supply their own pause/wake operations; this timer
 * never sees status reports or preview refreshes, so those can't hold a boot forever.
 * A busy operation gets time to finish, then pauses without starting a fresh timeout.
 */
import { inactivityTimeoutMs } from "./controlConfig";

export class Inactivity {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastActivity = Date.now();
  private paused = false;
  private hidden = false;
  private running = false;

  constructor(
    private readonly callbacks: { busy(): boolean; pause(): void; wake(): void },
    private readonly timeoutMs = inactivityTimeoutMs,
  ) {}

  start(): void {
    this.running = true;
    this.check();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
  }

  /** Only deliberate input renews the timeout or wakes a paused connection. */
  activity(): void {
    this.lastActivity = Date.now();
    if (this.paused) {
      this.paused = false;
      this.callbacks.wake();
    }
    this.check();
  }

  /** Visibility alone never reclaims a boot; leaving the app releases it promptly. */
  visibility(hidden: boolean): void {
    this.hidden = hidden;
    this.check();
  }

  private check = (): void => {
    clearTimeout(this.timer);
    if (!this.running || this.paused || this.timeoutMs === 0) return;
    const remaining = this.timeoutMs - (Date.now() - this.lastActivity);
    if (this.hidden || remaining <= 0) {
      if (this.callbacks.busy()) {
        this.timer = setTimeout(this.check, 250);
      } else {
        this.paused = true;
        this.callbacks.pause();
      }
    } else {
      this.timer = setTimeout(this.check, remaining);
    }
  };
}

/**
 * Attach once to an application's lifetime, returning cleanup for React effects.
 * A drag counts as activity, but hovering, focus, and incoming device data don't.
 * Checking elapsed time on visibility changes also handles delayed browser timers.
 */
export function observeActivity(idle: Inactivity): () => void {
  const activity = () => {
    if (document.visibilityState !== "hidden") idle.activity();
  };
  const drag = (event: PointerEvent) => {
    if (event.buttons !== 0) activity();
  };
  const visibility = () => idle.visibility(document.visibilityState === "hidden");
  document.addEventListener("pointerdown", activity, true);
  document.addEventListener("pointermove", drag, true);
  document.addEventListener("keydown", activity, true);
  document.addEventListener("input", activity, true);
  document.addEventListener("visibilitychange", visibility);
  idle.start();
  visibility();
  return () => {
    idle.stop();
    document.removeEventListener("pointerdown", activity, true);
    document.removeEventListener("pointermove", drag, true);
    document.removeEventListener("keydown", activity, true);
    document.removeEventListener("input", activity, true);
    document.removeEventListener("visibilitychange", visibility);
  };
}
