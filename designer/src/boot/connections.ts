// The boots this browser is connected to, for the Send to boot panel. It lives outside React, like the
// pattern library, so connections stay up when you move between patterns. A boot takes one connection
// and keeps its own flash, so each one here is connected and sent to on its own.

import { BootSession, type SendProgress } from "./bootSession";
import { compileRecipe } from "../recipe/compile";
import type { Recipe } from "../recipe/types";

type PickMethod = "bluetooth" | "usb";

// What this needs from the app's Transport, which fake and real boots both provide.
export interface BootTransport {
  readonly pickers: readonly PickMethod[];
  radioState(): Promise<string>;
  pick(method?: PickMethod): Promise<{ deviceId: string; name: string } | null>;
  open(deviceId: string, events: { onData(text: string): void; onClosed(): void }): Promise<{ write(line: string): Promise<void>; close(): Promise<void> }>;
}

export interface ConnectedBoot {
  deviceId: string;
  name: string;
  // What's happening, in words for the panel. Empty when idle.
  activity: string;
  // Whether `activity` reports a failure.
  failed: boolean;
  sending: boolean;
  // What's in this boot's upload slots. Null until it's known.
  uploads: string[] | null;
  slots: number | null;
}

export interface ConnectionsState {
  ready: boolean;
  pickers: readonly PickMethod[];
  // Why a connection attempt failed.
  error: string | null;
  connecting: boolean;
  boots: ConnectedBoot[];
}

interface LiveBoot {
  state: ConnectedBoot;
  session: BootSession;
  close(): Promise<void>;
}

const progressText = (progress: SendProgress): string => {
  if (progress.stage === "checking") return "Checking the boot…";
  if (progress.stage === "selecting") return "Selecting it…";
  return `Sending ${progress.sent} of ${progress.total} bytes…`;
};

export class BootConnections {
  private transport: BootTransport | null = null;
  private live = new Map<string, LiveBoot>();
  private listeners = new Set<() => void>();
  private snapshot: ConnectionsState = { ready: false, pickers: [], error: null, connecting: false, boots: [] };

  constructor(private readonly loadTransport: () => Promise<BootTransport>) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ConnectionsState => this.snapshot;

  private update(changes: Partial<ConnectionsState>): void {
    this.snapshot = { ...this.snapshot, boots: [...this.live.values()].map((boot) => boot.state), ...changes };
    for (const listener of this.listeners) listener();
  }

  private updateBoot(deviceId: string, changes: Partial<ConnectedBoot>): void {
    const boot = this.live.get(deviceId);
    if (!boot) return;
    boot.state = { ...boot.state, ...changes };
    this.update({});
  }

  // Loads the connection code and starts Bluetooth. Do this before a click calls connect(), because
  // a browser only shows its picker straight from a click, with nothing slow in between.
  async prepare(): Promise<void> {
    if (this.transport) return;
    try {
      this.transport = await this.loadTransport();
      await this.transport.radioState();
      this.update({ ready: true, pickers: this.transport.pickers, error: null });
    } catch (error) {
      this.update({ error: `Can't reach boots from this browser: ${(error as Error).message}` });
    }
  }

  async connect(method: PickMethod): Promise<void> {
    if (!this.transport) return;
    const transport = this.transport;
    this.update({ connecting: true, error: null });
    try {
      const found = await transport.pick(method);
      if (!found) return;
      if (this.live.has(found.deviceId)) return;

      let session: BootSession | null = null;
      const link = await transport.open(found.deviceId, {
        onData: (text) => session?.receive(text),
        onClosed: () => this.forget(found.deviceId),
      });
      session = new BootSession((line) => link.write(line));
      const status = await session.status();
      const name = typeof status.id === "string" ? `Firewalker-${status.id}` : found.name;
      this.live.set(found.deviceId, {
        session,
        close: () => link.close(),
        state: { deviceId: found.deviceId, name, activity: "", failed: false, sending: false, uploads: null, slots: null },
      });
      this.update({});
      await this.refreshUploads(found.deviceId);
    } catch (error) {
      this.update({ error: (error as Error).message });
    } finally {
      this.update({ connecting: false });
    }
  }

  private forget(deviceId: string): void {
    const boot = this.live.get(deviceId);
    if (!boot) return;
    boot.session.fail("The connection to the boot dropped.");
    this.live.delete(deviceId);
    this.update({});
  }

  async disconnect(deviceId: string): Promise<void> {
    const boot = this.live.get(deviceId);
    if (!boot) return;
    this.forget(deviceId);
    await boot.close().catch(() => undefined);
  }

  private async refreshUploads(deviceId: string): Promise<void> {
    const boot = this.live.get(deviceId);
    if (!boot) return;
    // A boot too old for recipes doesn't answer this, and Send says what to do about that.
    const recipes = await boot.session.recipes().catch(() => null);
    if (recipes) this.updateBoot(deviceId, { uploads: recipes.list as string[], slots: recipes.slots as number });
  }

  // Compiles the recipe as it is right now, so it needn't be saved first, then puts it on the boot.
  async send(deviceId: string, recipe: Recipe): Promise<void> {
    const boot = this.live.get(deviceId);
    if (!boot || boot.state.sending) return;
    const compiled = compileRecipe(recipe);
    if (!compiled.ok) {
      this.updateBoot(deviceId, { activity: compiled.errors[0] ?? "This recipe can't run on a boot.", failed: true });
      return;
    }
    this.updateBoot(deviceId, { sending: true, failed: false, activity: "" });
    const result = await boot.session.sendRecipe(recipe.name, compiled.bytes, (progress) =>
      this.updateBoot(deviceId, { activity: progressText(progress) }),
    );
    if (result.ok) {
      this.updateBoot(deviceId, {
        sending: false,
        failed: false,
        activity: result.alreadyThere ? `${recipe.name} was already on this boot, so it's selected now.` : `${recipe.name} is on the strip.`,
      });
      await this.refreshUploads(deviceId);
    } else {
      this.updateBoot(deviceId, { sending: false, failed: true, activity: result.error });
    }
  }

  async deleteUpload(deviceId: string, name: string): Promise<void> {
    const boot = this.live.get(deviceId);
    if (!boot) return;
    const failure = await boot.session.deleteRecipe(name).catch((error: Error) => error.message);
    this.updateBoot(deviceId, { activity: failure ?? `Deleted ${name} from this boot.`, failed: failure !== null });
    await this.refreshUploads(deviceId);
  }
}
