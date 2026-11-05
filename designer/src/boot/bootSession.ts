// Talks to one connected boot in its text protocol (docs/remote-protocol.md), and sends it a recipe.
// This knows nothing about Bluetooth or USB: it writes lines and is handed the text that comes back,
// so tests can run the whole exchange against fakeBoot.ts. connections.ts wires it to a real link.
//
// A boot's replies arrive alongside lines nobody asked for, such as status updates and log lines, so a
// request says which reply it's waiting for and everything else is skipped.

import { recipeCrc } from "../recipe/compile";

export type Reply = Record<string, unknown>;

// How long a boot gets to answer one line. It normally takes well under 100 ms.
const REPLY_TIMEOUT_MS = 3000;
// The most bytes one `recipe data` line can carry, which is what fits in the boot's 48-byte commands.
const BYTES_PER_LINE = 15;
// The first firmware protocol with the recipe commands.
export const RECIPE_PROTOCOL = 3;
// How many times one upload can be sent back to an earlier offset before giving up.
const MAX_RESENDS = 5;

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

export type SendProgress = { stage: "checking" } | { stage: "sending"; sent: number; total: number } | { stage: "selecting" };
export type SendResult = { ok: true; alreadyThere: boolean } | { ok: false; error: string };

interface Waiter {
  matches: (reply: Reply) => boolean;
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BootSession {
  private partial = "";
  private waiter: Waiter | null = null;

  constructor(private readonly write: (line: string) => Promise<void>) {}

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
  request(line: string, matches: (reply: Reply) => boolean): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error("The boot stopped answering."));
      }, REPLY_TIMEOUT_MS);
      this.waiter = { matches, resolve, reject, timer };
      this.write(line).catch((error: unknown) => {
        clearTimeout(timer);
        this.waiter = null;
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  status(): Promise<Reply> {
    return this.request("status", (reply) => reply.t === "status");
  }

  recipes(): Promise<Reply> {
    return this.request("recipes", (reply) => reply.t === "recipes");
  }

  // Deletes an upload, returning why not if it couldn't.
  async deleteRecipe(name: string): Promise<string | null> {
    const reply = await this.request(`recipe delete ${name}`, isRecipeAck);
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
          await this.request("recipe cancel", isRecipeAck).catch(() => undefined);
          return { ok: false, error: failure };
        }
      }

      onProgress({ stage: "selecting" });
      const selected = await this.request(`pattern ${name}`, (reply) => reply.t === "ack" && reply.cmd === "pattern");
      if (selected.ok !== true) return { ok: false, error: errorText(selected.error) };
      return { ok: true, alreadyThere };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  private async hasRecipe(name: string, bytes: Uint8Array): Promise<boolean> {
    const body = bytes.subarray(0, bytes.length - 4);
    const crc = recipeCrc(body).toString(16).padStart(8, "0");
    const info = await this.request(`recipe info ${name}`, (reply) => isRecipeAck(reply) || (reply.t === "recipe" && reply.name === name));
    return info.t === "recipe" && info.crc === crc && info.bytes === bytes.length;
  }

  // Sends the recipe a line at a time, waiting for each reply. Returns what went wrong, if anything. A
  // lost line gets `wrong-offset` and the place to carry on from.
  private async upload(name: string, bytes: Uint8Array, onProgress: (progress: SendProgress) => void): Promise<string | null> {
    const begun = await this.request(`recipe begin ${name} ${bytes.length}`, isRecipeAck);
    if (begun.ok !== true) return errorText(begun.error);

    let at = 0;
    let resends = 0;
    while (at < bytes.length) {
      onProgress({ stage: "sending", sent: at, total: bytes.length });
      const hex = Array.from(bytes.subarray(at, at + BYTES_PER_LINE), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const reply = await this.request(`recipe data ${at} ${hex}`, isRecipeAck);
      if (reply.ok === true) {
        at = reply.next as number;
      } else if (reply.error === "wrong-offset" && resends < MAX_RESENDS) {
        at = reply.next as number;
        resends++;
      } else {
        return errorText(reply.error);
      }
    }
    onProgress({ stage: "sending", sent: bytes.length, total: bytes.length });

    const ended = await this.request("recipe end", isRecipeAck);
    return ended.ok === true ? null : errorText(ended.error);
  }
}
