/**
 * One request and its matching reply on a boot's line protocol. BootClient lends
 * this exchange to the designer while it holds the command queue; BootSession
 * uses the same exchange for recipe retries and upload progress. Keeping framing
 * here lets the desktop share one physical connection without sharing raw ports.
 */
export type LineReply = Record<string, unknown>;
export interface LineExchange {
  request(line: string, matches: (reply: LineReply) => boolean, timeoutMs?: number): Promise<LineReply>;
}

export class LineSession implements LineExchange {
  private partial = "";
  private closed: Error | null = null;
  private waiter: {
    matches(reply: LineReply): boolean;
    resolve(reply: LineReply): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(private readonly write: (line: string) => Promise<void>) {}

  /** Text may contain several replies, or only part of one Bluetooth notification. */
  receive(text: string): void {
    this.partial += text;
    const lines = this.partial.split("\n");
    this.partial = lines.pop() ?? "";
    for (const line of lines) {
      let reply: unknown;
      try { reply = JSON.parse(line); } catch { continue; }
      if (typeof reply !== "object" || reply === null || Array.isArray(reply)) continue;
      const waiter = this.waiter;
      if (!waiter || !waiter.matches(reply as LineReply)) continue;
      clearTimeout(waiter.timer);
      this.waiter = null;
      waiter.resolve(reply as LineReply);
    }
  }

  /** Permanently ends this exchange so a retry cannot write into a replacement connection. */
  fail(reason: string): void {
    this.closed = new Error(reason);
    if (!this.waiter) return;
    clearTimeout(this.waiter.timer);
    this.waiter.reject(this.closed);
    this.waiter = null;
  }

  request(line: string, matches: (reply: LineReply) => boolean, timeoutMs = 3000): Promise<LineReply> {
    if (this.closed) return Promise.reject(this.closed);
    if (this.waiter) return Promise.reject(new Error("Wait for the previous boot reply first."));
    return new Promise((resolve, reject) => {
      const waiter = {
        matches, resolve, reject,
        timer: setTimeout(() => {
          if (this.waiter !== waiter) return;
          this.waiter = null;
          reject(new Error("The boot stopped answering."));
        }, timeoutMs),
      };
      this.waiter = waiter;
      this.write(line).catch((error: unknown) => {
        if (this.waiter !== waiter) return;
        clearTimeout(waiter.timer);
        this.waiter = null;
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}
