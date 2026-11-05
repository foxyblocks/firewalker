// Talks to one connected boot in its text protocol (docs/remote-protocol.md), and sends it a recipe.
// This knows nothing about Bluetooth or USB: it writes lines and is handed the text that comes back,
// so tests can run the whole exchange against fakeBoot.ts. connections.ts wires it to a real link.
//
// A boot's replies arrive alongside lines nobody asked for, such as status updates and log lines, so a
// request says which reply it's waiting for and everything else is skipped.

import { recipeCrc } from "../recipe/compile";

export type Reply = Record<string, unknown>;

// How long a boot gets to answer one line, unless a caller says otherwise. It normally takes well under
// 100 ms.
const REPLY_TIMEOUT_MS = 3000;
// How many recipe bytes go on one `recipe data` line. Bluetooth delivers a line whole, so it can carry
// the 15 bytes that fit a boot's 48-byte commands. USB arrives a byte at a time into a 32-byte buffer that
// the boot only empties between jobs, such as while it isn't sending a frame to the strip. A longer line
// can overflow that and lose characters, so USB uses 7 bytes, which keeps the longest line to 30
// characters plus its newline. A client waits for each reply, so the buffer is empty when a line starts.
export const BYTES_PER_BLUETOOTH_LINE = 15;
export const BYTES_PER_USB_LINE = 7;
// The first firmware protocol with the recipe commands.
export const RECIPE_PROTOCOL = 3;
// A line over USB can still lose characters now and then, about 0.3% of them on a real boot, and it can
// lose its newline, which leaves no reply at all. So everything here retries. That's safe because the
// offset on each line stops a repeat from being stored twice, and the recipe's checksum catches the rest.
const LINE_TIMEOUT_MS = 500;
const ASK_ATTEMPTS = 3;
const MAX_LINE_FAILURES = 8;
// Saving a recipe can take the boot a moment, so it gets this many times as long to answer.
const SAVE_TIMEOUT_FACTOR = 6;
const UPLOAD_ATTEMPTS = 3;
// Errors that retrying can't fix, because they're about the recipe or the boot, not one damaged line.
const LASTING_ERRORS = new Set(["no-room", "name-reserved", "bad-name", "bad-recipe", "unsupported-version", "save-failed"]);

export const NEEDS_FIRMWARE = "This boot needs a firmware update over USB before it can take recipes.";

const ERROR_TEXT: Record<string, string> = {
  "no-room": "This boot's recipe slots are full. Delete one from it first.",
  "too-big": "This recipe is too big for a boot.",
  "name-reserved": "A boot keeps that name for itself. Rename the recipe.",
  "bad-checksum": "The recipe was damaged on the way. Try again.",
  "unsupported-version": NEEDS_FIRMWARE,
  "save-failed": "The boot couldn't save the recipe to its flash.",
};

const errorText = (code: unknown) => ERROR_TEXT[String(code)] ?? `The boot refused the recipe (${String(code)}).`;

const isRecipeAck = (reply: Reply) => reply.t === "ack" && reply.cmd === "recipe";
// A line too damaged to parse comes back as an ack with no command name.
const isUnparsed = (reply: Reply) => reply.t === "ack" && reply.cmd === "unknown";
const isLineReply = (reply: Reply) => isRecipeAck(reply) || isUnparsed(reply);
const isPatternAck = (reply: Reply) => reply.t === "ack" && reply.cmd === "pattern";

export type SendProgress = { stage: "checking" } | { stage: "sending"; sent: number; total: number } | { stage: "selecting" };
export type SendResult = { ok: true; alreadyThere: boolean } | { ok: false; error: string };

interface Waiter {
  matches: (reply: Reply) => boolean;
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BootAudioConfig {
  ready: boolean;
  noiseFloor: number;
  sensitivity: number;
  calibrating: boolean;
}

export class BootSession {
  private partial = "";
  private waiter: Waiter | null = null;

  constructor(
    private readonly write: (line: string) => Promise<void>,
    private readonly bytesPerLine: number = BYTES_PER_BLUETOOTH_LINE,
    private readonly lineTimeoutMs: number = LINE_TIMEOUT_MS,
  ) {}

  // Hands over text from the link. It can hold part of a line, or several.
  receive(text: string): void {
    this.partial += text;
    const lines = this.partial.split("\n");
    this.partial = lines.pop() ?? "";
    for (const line of lines) this.receiveLine(line);
  }

  private receiveLine(line: string): void {
    if (!this.waiter) return;
    let reply: unknown;
    try {
      reply = JSON.parse(line);
    } catch {
      return; // the firmware's log lines aren't JSON
    }
    if (typeof reply !== "object" || reply === null) return;
    if (!this.waiter.matches(reply as Reply)) return;
    const { resolve, timer } = this.waiter;
    clearTimeout(timer);
    this.waiter = null;
    resolve(reply as Reply);
  }

  // Ends anything waiting on this boot, such as when its link drops.
  fail(reason: string): void {
    if (!this.waiter) return;
    const { reject, timer } = this.waiter;
    clearTimeout(timer);
    this.waiter = null;
    reject(new Error(reason));
  }

  // Sends one line and waits for the reply it calls for. Only one runs at a time, because a boot
  // handles one command at a time, and its replies carry nothing to tell them apart.
  request(line: string, matches: (reply: Reply) => boolean, timeoutMs: number = REPLY_TIMEOUT_MS): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error("The boot stopped answering."));
      }, timeoutMs);
      this.waiter = { matches, resolve, reject, timer };
      this.write(line).catch((error: unknown) => {
        clearTimeout(timer);
        this.waiter = null;
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  // Sends a line until the reply it calls for arrives, in case the line gets damaged on the way. Rejects
  // if it never does. `settled` can also ask to go again after a reply, for a refusal that a damaged name
  // could explain.
  private async ask(line: string, matches: (reply: Reply) => boolean, settled: (reply: Reply) => boolean = () => true): Promise<Reply> {
    let last: Reply | null = null;
    for (let attempt = 0; attempt < ASK_ATTEMPTS; attempt++) {
      const reply = await this.request(line, (candidate) => matches(candidate) || isUnparsed(candidate), this.lineTimeoutMs).catch(() => null);
      if (!reply || isUnparsed(reply)) continue;
      last = reply;
      if (settled(reply)) return reply;
    }
    if (last) return last;
    throw new Error("The boot stopped answering.");
  }

  async audioConfig(): Promise<BootAudioConfig> {
    const reply = await this.ask("audio", (answer) => answer.t === "audio-config");
    if (typeof reply.noiseFloor !== "number" || typeof reply.sensitivity !== "number") {
      throw new Error("The boot returned incomplete audio settings.");
    }
    return { ready: reply.ready === true, noiseFloor: reply.noiseFloor,
      sensitivity: reply.sensitivity, calibrating: reply.calibrating === true };
  }

  async configureAudio(sensitivity?: number): Promise<BootAudioConfig> {
    const command = sensitivity === undefined ? "audio calibrate" : `audio gain ${Math.round(sensitivity)}`;
    const reply = await this.ask(command, (answer) => answer.t === "ack" && answer.cmd === "audio", (answer) => answer.ok === true);
    if (!reply.ok) throw new Error(String(reply.error ?? "Couldn't change audio settings."));
    for (let attempt = 0; attempt < 15; attempt++) {
      const config = await this.audioConfig();
      if (!config.ready) throw new Error("Microphone capture is unavailable.");
      if (!config.calibrating) return config;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("Quiet calibration did not finish. Try again with the room quiet.");
  }

  status(): Promise<Reply> {
    return this.ask("status", (reply) => reply.t === "status");
  }

  recipes(): Promise<Reply> {
    return this.ask("recipes", (reply) => reply.t === "recipes");
  }

  // Deletes an upload, returning why not if it couldn't.
  async deleteRecipe(name: string): Promise<string | null> {
    const reply = await this.ask(`recipe delete ${name}`, isRecipeAck, (answer) => answer.ok === true);
    return reply.ok === true ? null : errorText(reply.error);
  }

  // Puts a compiled recipe on this boot and selects it. It first checks the boot can read this version,
  // and skips the upload if the boot already has these exact bytes. If anything fails partway, nothing
  // changes on the boot, because it only saves after the whole recipe checks out.
  async sendRecipe(name: string, bytes: Uint8Array, onProgress: (progress: SendProgress) => void = () => undefined): Promise<SendResult> {
    try {
      onProgress({ stage: "checking" });
      const status = await this.status();
      if (typeof status.proto !== "number" || status.proto < RECIPE_PROTOCOL) return { ok: false, error: NEEDS_FIRMWARE };
      const recipes = await this.recipes();
      if (!(recipes.versions as number[] | undefined)?.includes(bytes[0]!)) return { ok: false, error: NEEDS_FIRMWARE };

      const alreadyThere = await this.hasRecipe(name, bytes);
      if (!alreadyThere) {
        const failure = await this.upload(name, bytes, onProgress);
        if (failure) {
          await this.ask("recipe cancel", isRecipeAck).catch(() => undefined);
          return { ok: false, error: failure };
        }
      }

      onProgress({ stage: "selecting" });
      const selected = await this.ask(`pattern ${name}`, isPatternAck, (reply) => reply.ok === true);
      if (selected.ok !== true) return { ok: false, error: errorText(selected.error) };
      return { ok: true, alreadyThere };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  private async hasRecipe(name: string, bytes: Uint8Array): Promise<boolean> {
    const body = bytes.subarray(0, bytes.length - 4);
    const crc = recipeCrc(body).toString(16).padStart(8, "0");
    const info = await this.ask(`recipe info ${name}`, (reply) => isRecipeAck(reply) || (reply.t === "recipe" && reply.name === name));
    return info.t === "recipe" && info.crc === crc && info.bytes === bytes.length;
  }

  // One line of an upload. Null means no reply came, as when the line lost its newline.
  private uploadLine(line: string): Promise<Reply | null> {
    return this.request(line, isLineReply, this.lineTimeoutMs).catch(() => null);
  }

  // Sends the recipe, starting over if an attempt fails in a way that retrying can fix. Returns what went
  // wrong, if anything.
  private async upload(name: string, bytes: Uint8Array, onProgress: (progress: SendProgress) => void): Promise<string | null> {
    let failure = "";
    for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt++) {
      const code = await this.uploadOnce(name, bytes, onProgress);
      if (code === null) return null;
      if (LASTING_ERRORS.has(code)) return errorText(code);
      failure = code;
    }
    return failure === "no-reply" ? "The boot stopped answering." : errorText(failure);
  }

  // One attempt: `begin`, the data a line at a time with each waiting on its reply, then `end`. A line that
  // fails is sent again, from wherever the boot says it's up to. Returns an error code, or null if it worked.
  private async uploadOnce(name: string, bytes: Uint8Array, onProgress: (progress: SendProgress) => void): Promise<string | null> {
    let failures = 0;
    let last = "no-reply";
    // Retries one line until it gets a reply saying it worked, and returns that reply.
    const untilAccepted = async (line: () => string, onRefused: (reply: Reply) => void = () => undefined): Promise<Reply | null> => {
      while (failures <= MAX_LINE_FAILURES) {
        const reply = await this.uploadLine(line());
        if (reply?.ok === true && reply.cmd === "recipe") return reply;
        if (reply) {
          last = String(reply.error);
          if (LASTING_ERRORS.has(last) || last === "too-big" || last === "no-upload") return null;
          onRefused(reply);
        } else {
          last = "no-reply";
        }
        failures++;
      }
      return null;
    };

    if (!(await untilAccepted(() => `recipe begin ${name} ${bytes.length}`))) return last;

    let at = 0;
    while (at < bytes.length) {
      onProgress({ stage: "sending", sent: at, total: bytes.length });
      const reply = await untilAccepted(
        () => {
          const hex = Array.from(bytes.subarray(at, at + this.bytesPerLine), (byte) => byte.toString(16).padStart(2, "0")).join("");
          return `recipe data ${at} ${hex}`;
        },
        (refused) => {
          if (typeof refused.next === "number") at = refused.next;
        },
      );
      if (!reply) return last;
      at = reply.next as number;
    }
    onProgress({ stage: "sending", sent: bytes.length, total: bytes.length });

    const ended = await this.request("recipe end", isLineReply, this.lineTimeoutMs * SAVE_TIMEOUT_FACTOR).catch(() => null);
    if (!ended) return "no-reply";
    return ended.ok === true ? null : String(ended.error);
  }
}
