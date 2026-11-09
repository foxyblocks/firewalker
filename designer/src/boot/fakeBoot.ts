// A pretend boot that speaks the recipe commands the way the firmware does, for tests and for trying
// the Send to boot panel with no boot around (open the designer with `?boot=fake`). It covers what the
// designer uses, including how the firmware's replies look, and its checks mirror
// include/firewalker_recipe_upload.h.

import type { PickMethod } from "../../../app/src/transport/transport";
import type { BootPortsClient, FreeResult, PortHolder } from "./portHolders";
import { decodeRecipe, MAX_COMPILED_BYTES, recipeCrc } from "../recipe/compile";
import { RECIPE_VERSION } from "../recipe/types";

export interface FakeBootOptions {
  id?: string;
  proto?: number;
  versions?: number[];
  slots?: number;
  // Never answers, like a boot whose link has gone quiet.
  silent?: boolean;
  // Loses the end of any line longer than this, like a boot's 32-byte USB buffer overflowing.
  receiveBytes?: number;
  // Changes what arrives, as USB can. It gets each line and how many came before it, and returns what the
  // boot receives, or null if the line lost its newline, so it joins onto the next one with no reply.
  damage?: (line: string, index: number) => string | null;
}

export class FakeBoot {
  readonly id: string;
  readonly proto: number;
  readonly versions: number[];
  readonly slots: number;
  silent: boolean;
  readonly receiveBytes: number;
  private readonly damage: (line: string, index: number) => string | null;
  private lineCount = 0;
  private unfinished = "";
  // Each uploaded recipe's bytes, by name.
  readonly stored = new Map<string, Uint8Array>();
  pattern = "rainbow-pool";
  // Skips storing the next `recipe data` line while still reporting success, as if a line went
  // missing, so the following one comes in at the wrong offset.
  loseNextData = false;
  linesSeen: string[] = [];

  private upload: { name: string; size: number; bytes: number[] } | null = null;

  constructor(options: FakeBootOptions = {}) {
    this.id = options.id ?? "FA4E";
    this.proto = options.proto ?? 3;
    this.versions = options.versions ?? [1, RECIPE_VERSION];
    this.slots = options.slots ?? 16;
    this.silent = options.silent ?? false;
    this.receiveBytes = options.receiveBytes ?? Number.POSITIVE_INFINITY;
    this.damage = options.damage ?? ((line) => line);
  }

  // Handles one command, returning the lines it answers with.
  handle(sent: string): string[] {
    this.linesSeen.push(sent);
    if (this.silent) return [];
    const arrived = this.damage(sent, this.lineCount++);
    if (arrived === null) {
      this.unfinished += sent;
      return [];
    }
    const line = (this.unfinished + arrived).slice(0, this.receiveBytes);
    this.unfinished = "";
    const words = line.trim().split(/\s+/);
    if (line.length >= 48 || words.length > 4) return [JSON.stringify({ t: "ack", cmd: "unknown", ok: false, error: "too-long" })];
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
        if (words[3]!.length % 2 !== 0) return [recipeAck(false, "bad-hex", this.upload.bytes.length)];
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
        return [recipeAck(true), reply({ t: "patterns", list: [...new Set(["comet", "fire-stomp", "rainbow-pool", ...this.stored.keys()])].sort() })];
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

const FAKE_HOLDERS: Record<string, Omit<PortHolder, "port">> = {
  tool: { pid: 4242, process: "cli", kind: "tool", name: "./cli", canFree: true },
  browser: { pid: 4243, process: "Arc Helper", kind: "browser", name: "A browser tab", canFree: false },
  other: { pid: 4244, process: "SomeApp", kind: "other", name: "SomeApp", canFree: false },
};

// Pretends something holds a boot's USB port, for tests and for `?boot=fake&busy=tool`.
export class FakeBootPorts implements BootPortsClient {
  holders: PortHolder[];
  freed: number[] = [];

  constructor(busy: string | null = null) {
    const holder = busy ? FAKE_HOLDERS[busy] : undefined;
    this.holders = holder ? [{ ...holder, port: "/dev/cu.usbmodemFAKE1" }] : [];
  }

  async list(): Promise<PortHolder[]> {
    return this.holders;
  }

  async free(pid: number): Promise<FreeResult> {
    const holder = this.holders.find((candidate) => candidate.pid === pid);
    if (holder && !holder.canFree) return { freed: false, error: "Only the bench tools can be closed from here." };
    this.freed.push(pid);
    this.holders = this.holders.filter((candidate) => candidate.pid !== pid);
    return { freed: true };
  }
}

// The part of the app's Transport that connections.ts uses, over pretend boots.
export class FakeBootTransport {
  readonly pickers: readonly PickMethod[] = ["usb", "bluetooth"];
  readonly boots: FakeBoot[];
  private next = 0;

  constructor(
    boots: FakeBoot[] = [new FakeBoot({ id: "3EB5" }), new FakeBoot({ id: "3ED8" })],
    private readonly ports: FakeBootPorts = new FakeBootPorts(),
  ) {
    this.boots = boots;
  }

  async radioState(): Promise<"on"> {
    return "on";
  }

  async pick(method: PickMethod = "bluetooth"): Promise<{ deviceId: string; name: string } | null> {
    if (method === "usb" && this.ports.holders.length > 0) throw new Error("Couldn't open that boot's USB port.");
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
