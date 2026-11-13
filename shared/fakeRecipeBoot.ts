// A pretend boot's recipe slots: it speaks the recipe commands the way the firmware does, for tests
// and for trying recipe features with no boot around. The designer's Send to boot panel uses it
// (designer/src/boot/fakeBoot.ts adds the designer's full decoder), and so does the iPhone app's
// fake mode, where pattern sync runs against it (app/src/transport/fakeRecipes.ts). It covers how
// the firmware's replies look, and its checks mirror include/firewalker_recipe_upload.h. Keep it
// free of the designer's compiler, because the phone's bundle imports it in fake mode.

import { checkCompiledRecipe, compiledCrc, MAX_COMPILED_BYTES, type CompiledCheck } from "./recipeBinary";

export interface FakeRecipeBootOptions {
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
  // Checks a finished upload before storing it, as the firmware's decoder does. The default checks the
  // size, checksum, and header name (checkCompiledRecipe). The designer passes its full decoder, so its
  // tests also catch a compiler bug.
  check?: (bytes: Uint8Array) => CompiledCheck;
}

export class FakeRecipeBoot {
  readonly id: string;
  readonly proto: number;
  readonly versions: number[];
  readonly slots: number;
  silent: boolean;
  readonly receiveBytes: number;
  private readonly damage: (line: string, index: number) => string | null;
  private readonly check: (bytes: Uint8Array) => CompiledCheck;
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

  constructor(options: FakeRecipeBootOptions = {}) {
    this.id = options.id ?? "FA4E";
    this.proto = options.proto ?? 3;
    // The recipe versions current firmware reads (RECIPE_VERSION in designer/src/recipe/types.ts).
    this.versions = options.versions ?? [1, 2];
    this.slots = options.slots ?? 16;
    this.silent = options.silent ?? false;
    this.receiveBytes = options.receiveBytes ?? Number.POSITIVE_INFINITY;
    this.damage = options.damage ?? ((line) => line);
    this.check = options.check ?? checkCompiledRecipe;
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
        return [reply({ t: "recipe", name: words[2], bytes: bytes.length, crc: compiledCrc(bytes) })];
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
        const checked = this.check(data);
        if (!checked.ok) return [recipeAck(false, checked.error)];
        if (!this.versions.includes(checked.version)) return [recipeAck(false, "unsupported-version")];
        if (checked.name !== name) return [recipeAck(false, "name-mismatch")];
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
