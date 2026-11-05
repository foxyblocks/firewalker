// A pretend boot that speaks the recipe commands the way the firmware does, for tests and for trying
// the Send to boot panel with no boot around (open the designer with `?boot=fake`). It covers what the
// designer uses, including how the firmware's replies look, and its checks mirror
// include/firewalker_recipe_upload.h.

import type { PickMethod } from "../../../app/src/transport/transport";
import { decodeRecipe, MAX_COMPILED_BYTES, recipeCrc } from "../recipe/compile";
import { RECIPE_VERSION } from "../recipe/types";

export interface FakeBootOptions {
  id?: string;
  proto?: number;
  versions?: number[];
  slots?: number;
  // Never answers, like a boot whose link has gone quiet.
  silent?: boolean;
}

export class FakeBoot {
  readonly id: string;
  readonly proto: number;
  readonly versions: number[];
  readonly slots: number;
  silent: boolean;
  // Each uploaded recipe's bytes, by name.
  readonly stored = new Map<string, Uint8Array>();
  pattern = "flow";
  // Skips storing the next `recipe data` line while still reporting success, as if a line went
  // missing, so the following one comes in at the wrong offset.
  loseNextData = false;
  linesSeen: string[] = [];

  private upload: { name: string; size: number; bytes: number[] } | null = null;

  constructor(options: FakeBootOptions = {}) {
    this.id = options.id ?? "FA4E";
    this.proto = options.proto ?? 3;
    this.versions = options.versions ?? [RECIPE_VERSION];
    this.slots = options.slots ?? 16;
    this.silent = options.silent ?? false;
  }

  // Handles one command, returning the lines it answers with.
  handle(line: string): string[] {
    this.linesSeen.push(line);
    if (this.silent) return [];
    const words = line.trim().split(/\s+/);
    const reply = (value: unknown) => JSON.stringify(value);
    const recipeAck = (ok: boolean, error?: string, next?: number) =>
      reply({ t: "ack", cmd: "recipe", ok, ...(error ? { error } : {}), ...(next !== undefined ? { next } : {}) });

    switch (words[0]) {
      case "status":
        return [reply({ t: "status", proto: this.proto, id: this.id, pattern: this.pattern })];
      case "recipes":
        return [
          reply({
            t: "recipes",
            versions: this.versions,
            slots: this.slots,
            free: this.slots - this.stored.size,
            list: [...this.stored.keys()],
          }),
        ];
      case "pattern":
        this.pattern = words[1]!;
        return [reply({ t: "ack", cmd: "pattern", ok: true }), reply({ t: "status", proto: this.proto, id: this.id, pattern: this.pattern })];
      case "recipe":
        break;
      default:
        return [reply({ t: "ack", cmd: "unknown", ok: false, error: "unknown-command" })];
    }

    switch (words[1]) {
      case "info": {
        const bytes = this.stored.get(words[2]!);
        if (!bytes) return [recipeAck(false, "not-found")];
        const crc = recipeCrc(bytes.subarray(0, bytes.length - 4)).toString(16).padStart(8, "0");
        return [reply({ t: "recipe", name: words[2], bytes: bytes.length, crc })];
      }
      case "begin": {
        const size = Number(words[3]);
        if (size > MAX_COMPILED_BYTES) return [recipeAck(false, "too-big")];
        if (!this.stored.has(words[2]!) && this.stored.size >= this.slots) return [recipeAck(false, "no-room")];
        this.upload = { name: words[2]!, size, bytes: [] };
        return [recipeAck(true, undefined, 0)];
      }
      case "data": {
        if (!this.upload) return [recipeAck(false, "no-upload")];
        const offset = Number(words[2]);
        if (offset !== this.upload.bytes.length) return [recipeAck(false, "wrong-offset", this.upload.bytes.length)];
        const incoming = (words[3]!.match(/../g) ?? []).map((pair) => parseInt(pair, 16));
        if (this.loseNextData) {
          this.loseNextData = false;
          return [recipeAck(true, undefined, offset + incoming.length)];
        }
        this.upload.bytes.push(...incoming);
        return [recipeAck(true, undefined, this.upload.bytes.length)];
      }
      case "end": {
        if (!this.upload) return [recipeAck(false, "no-upload")];
        const { name, size, bytes } = this.upload;
        this.upload = null;
        if (bytes.length < size) return [recipeAck(false, "short")];
        const data = Uint8Array.from(bytes);
        const decoded = decodeRecipe(data);
        if (!decoded.ok) return [recipeAck(false, decoded.error.includes("checksum") ? "bad-checksum" : "bad-recipe")];
        if (decoded.recipe.name !== name) return [recipeAck(false, "name-mismatch")];
        this.stored.set(name, data);
        return [recipeAck(true), reply({ t: "patterns", list: ["flow", "fire-trail", ...this.stored.keys()] })];
      }
      case "cancel":
        this.upload = null;
        return [recipeAck(true)];
      case "delete":
        if (!this.stored.delete(words[2]!)) return [recipeAck(false, "not-found")];
        return [recipeAck(true)];
      default:
        return [recipeAck(false, "unknown-recipe-command")];
    }
  }
}

// The part of the app's Transport that connections.ts uses, over pretend boots.
export class FakeBootTransport {
  readonly pickers: readonly PickMethod[] = ["usb", "bluetooth"];
  readonly boots: FakeBoot[];
  private next = 0;

  constructor(boots: FakeBoot[] = [new FakeBoot({ id: "3EB5" }), new FakeBoot({ id: "3ED8" })]) {
    this.boots = boots;
  }

  async radioState(): Promise<"on"> {
    return "on";
  }

  async pick(method: PickMethod = "bluetooth"): Promise<{ deviceId: string; name: string } | null> {
    const boot = this.boots[this.next++ % this.boots.length]!;
    return { deviceId: `${method}:${boot.id}`, name: `Firewalker-${boot.id}` };
  }

  async open(deviceId: string, events: { onData(text: string): void; onClosed(): void }): Promise<{ write(line: string): Promise<void>; close(): Promise<void> }> {
    const boot = this.boots.find((candidate) => deviceId.endsWith(candidate.id))!;
    return {
      write: async (line) => {
        const lines = boot.handle(line);
        queueMicrotask(() => {
          for (const reply of lines) events.onData(`${reply}\n`);
        });
      },
      close: async () => events.onClosed(),
    };
  }
}
