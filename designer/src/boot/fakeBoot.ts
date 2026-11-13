// The designer's pretend boots, for tests and for trying the Send to boot panel with no boot around
// (open the designer with `?boot=fake`). FakeBoot is the shared pretend boot (shared/fakeRecipeBoot.ts)
// checking uploads with the designer's full decoder, the same checks the firmware's decoder makes, so
// a compiler bug shows up in these tests too.

import type { PickMethod } from "../../../app/src/transport/transport";
import { FakeRecipeBoot, type FakeRecipeBootOptions } from "../../../shared/fakeRecipeBoot";
import type { BootPortsClient, FreeResult, PortHolder } from "./portHolders";
import { decodeRecipe } from "../recipe/compile";
import type { CompiledCheck } from "../../../shared/recipeBinary";
import { RECIPE_VERSION } from "../recipe/types";

export type FakeBootOptions = FakeRecipeBootOptions;

// What the firmware's decoder says about a finished upload, in its error codes.
function decodeCheck(bytes: Uint8Array): CompiledCheck {
  const decoded = decodeRecipe(bytes);
  if (!decoded.ok) return { ok: false, error: decoded.error.includes("checksum") ? "bad-checksum" : "bad-recipe", reason: decoded.error };
  return { ok: true, version: decoded.recipe.version, name: decoded.recipe.name, crc: "" };
}

export class FakeBoot extends FakeRecipeBoot {
  constructor(options: FakeBootOptions = {}) {
    super({ versions: [1, RECIPE_VERSION], check: decodeCheck, ...options });
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
