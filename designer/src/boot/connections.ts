// The boots this browser is connected to, for the Send to boot panel. It lives outside React, like the
// pattern library, so connections stay up when you move between patterns. A boot takes one connection
// and keeps its own flash, so each one here is connected and sent to on its own.
//
// When a connection fails, this also works out why, because "something" holding a boot is the usual trouble.
// Over USB it asks the dev server which program has the port (portHolders.ts), and can close our own bench
// tools. Over Bluetooth nothing can say who's connected, so it says who it most likely is.
// Human activity is shared with the remote (shared/inactivity.ts). Pausing keeps each
// boot's identity and recipe list, while releasing the actual link. Waking opens a
// fresh session and reads the boot again before a Send or Delete can change anything.

import { BootSession, BYTES_PER_BLUETOOTH_LINE, BYTES_PER_USB_LINE, type SendProgress } from "./bootSession";
import { devServerPorts, type BootPortsClient, type PortHolder } from "./portHolders";
import { compileRecipe } from "../recipe/compile";
import type { Recipe } from "../recipe/types";
import { Inactivity, observeActivity } from "../../../shared/inactivity";

type PickMethod = "bluetooth" | "usb";

// A boot stops advertising once something's connected, so it drops out of the browser's picker, and a connection
// attempt fails or times out. Nothing here can ask who it is, but it's nearly always the iPhone app.
const BLUETOOTH_TAKEN = "A boot takes one Bluetooth connection at a time, and it's usually the phone app. Close the app, or connect over USB.";

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
  paused: boolean;
  // What's in this boot's upload slots. Null until it's known.
  uploads: string[] | null;
  slots: number | null;
}

export interface ConnectionsState {
  ready: boolean;
  pickers: readonly PickMethod[];
  // Why a connection attempt failed.
  error: string | null;
  // A suggestion that isn't a failure, such as what to try when a boot isn't in the picker.
  hint: string | null;
  // What's holding a boot's USB port, when that's in the way.
  holders: PortHolder[];
  // The holder being closed, by pid.
  freeing: number | null;
  connecting: boolean;
  boots: ConnectedBoot[];
}

interface LiveBoot {
  state: ConnectedBoot;
  session: BootSession;
  close(): Promise<void>;
  closing: Promise<void>;
  opening: Promise<void> | null;
  generation: number;
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
  private readonly inactivity = new Inactivity({
    busy: () => this.snapshot.connecting || [...this.live.values()].some((boot) => boot.state.sending || boot.opening !== null),
    pause: () => this.pause(),
    wake: () => {
      for (const boot of this.live.values()) {
        if (boot.state.paused) void this.reconnect(boot.state.deviceId);
      }
    },
  });
  private snapshot: ConnectionsState = { ready: false, pickers: [], error: null, hint: null, holders: [], freeing: null, connecting: false, boots: [] };

  constructor(
    private readonly loadTransport: () => Promise<BootTransport>,
    private readonly ports: BootPortsClient = devServerPorts,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ConnectionsState => this.snapshot;

  /** Called by the app frame, so editing a recipe also counts as deliberate use. */
  observeActivity(): () => void {
    return observeActivity(this.inactivity);
  }

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
    if (!this.transport) {
      try {
        this.transport = await this.loadTransport();
        await this.transport.radioState();
        this.update({ ready: true, pickers: this.transport.pickers, error: null });
      } catch (error) {
        this.update({ error: `Can't reach boots from this browser: ${(error as Error).message}` });
        return;
      }
    }
    // Says up front if one of our tools is in the way. A browser holding a port is usually this very tab, with
    // the boot connected and working, so that only comes up if connecting fails.
    const holders = await this.listHolders();
    this.update({ holders: holders.filter((holder) => holder.kind !== "browser") });
  }

  // Holders, or none if the dev server isn't there to ask, as in a built copy.
  private listHolders(): Promise<PortHolder[]> {
    return this.ports.list().catch(() => []);
  }

  async connect(method: PickMethod): Promise<void> {
    if (!this.transport) return;
    const transport = this.transport;
    this.update({ connecting: true, error: null, hint: null, holders: [] });
    try {
      const found = await transport.pick(method);
      if (!found) {
        // A boot with something connected isn't in Bluetooth's picker, so that's a likely reason for cancelling it.
        if (method === "bluetooth") this.update({ hint: `Don't see your boot? ${BLUETOOTH_TAKEN}` });
        return;
      }
      if (this.live.has(found.deviceId)) return;

      let session: BootSession | null = null;
      let boot: LiveBoot | null = null;
      const link = await transport.open(found.deviceId, {
        onData: (text) => session?.receive(text),
        onClosed: () => {
          if (boot && boot.generation === 0) this.forget(found.deviceId);
        },
      });
      const bytesPerLine = found.deviceId.startsWith("usb:") ? BYTES_PER_USB_LINE : BYTES_PER_BLUETOOTH_LINE;
      session = new BootSession((line) => link.write(line), bytesPerLine);
      const status = await session.status().catch(async (error: unknown) => {
        await link.close().catch(() => undefined);
        throw error;
      });
      const name = typeof status.id === "string" ? `Firewalker-${status.id}` : found.name;
      boot = {
        session,
        close: () => link.close(),
        closing: Promise.resolve(), opening: null, generation: 0,
        state: { deviceId: found.deviceId, name, activity: "", failed: false, sending: false, paused: false, uploads: null, slots: null },
      };
      this.live.set(found.deviceId, boot);
      this.update({});
      await this.refreshUploads(found.deviceId);
    } catch (error) {
      await this.explainFailure(method, (error as Error).message);
    } finally {
      this.update({ connecting: false });
    }
  }

  // Says why a connection failed. Naming what holds the port beats the browser's general error.
  private async explainFailure(method: PickMethod, message: string): Promise<void> {
    if (method === "bluetooth") {
      this.update({ error: BLUETOOTH_TAKEN });
      return;
    }
    const holders = await this.listHolders();
    if (holders.length > 0) this.update({ holders });
    else this.update({ error: message });
  }

  // Closes one of our own bench tools that's holding a port, then tries connecting again. The server decides
  // whether that's allowed, whatever this asks for. The click that started this also has to open the browser's
  // port picker, and if it took too long, the picker won't show, so that case says what to press.
  async free(holder: PortHolder): Promise<void> {
    if (this.snapshot.freeing !== null) return;
    this.update({ freeing: holder.pid, error: null, hint: null });
    const result = await this.ports.free(holder.pid).catch((error: Error) => ({ freed: false, error: error.message }));
    if (!result.freed) {
      this.update({ freeing: null, error: result.error ?? `${holder.name} didn't close. Quit it yourself, then connect again.` });
      return;
    }
    this.update({ freeing: null, holders: this.snapshot.holders.filter((other) => other.pid !== holder.pid) });

    const before = this.live.size;
    await this.connect("usb");
    const { error, holders } = this.snapshot;
    if (this.live.size === before && !error && holders.length === 0) {
      this.update({ hint: `${holder.name} is closed, so the port's free. Press Connect over USB.` });
    }
  }

  private forget(deviceId: string): void {
    const boot = this.live.get(deviceId);
    if (!boot) return;
    boot.generation++;
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

  private pause(): void {
    for (const boot of this.live.values()) {
      if (boot.state.paused) continue;
      // Ignore the close callback from this deliberate release. The row stays here
      // so returning to the designer doesn't require picking the same boot again.
      boot.generation++;
      boot.session.fail("Connection paused.");
      boot.state = { ...boot.state, paused: true, activity: "Paused while idle. Send reconnects.", failed: false };
      boot.closing = boot.close().catch(() => undefined);
    }
    this.update({});
  }

  /** One reconnect per boot; a wake and a Send share the same attempt. */
  async reconnect(deviceId: string): Promise<void> {
    const boot = this.live.get(deviceId);
    if (!boot || !this.transport) return;
    if (boot.opening) return boot.opening;
    if (!boot.state.paused) return;
    boot.opening = this.reopen(boot).catch((error: Error) => {
      this.updateBoot(deviceId, { failed: true, activity: `Couldn't reconnect. ${error.message}` });
    }).finally(() => {
      boot.opening = null;
      this.update({});
    });
    return boot.opening;
  }

  private async reopen(boot: LiveBoot): Promise<void> {
    const deviceId = boot.state.deviceId;
    const generation = ++boot.generation;
    this.updateBoot(deviceId, { activity: "Reconnecting…", failed: false });
    await boot.closing;
    if (this.live.get(deviceId) !== boot) return;
    let session: BootSession | null = null;
    const link = await this.transport!.open(deviceId, {
      onData: (text) => session?.receive(text),
      onClosed: () => {
        if (this.live.get(deviceId) === boot && boot.generation === generation && !boot.state.paused) this.forget(deviceId);
      },
    });
    try {
      session = new BootSession((line) => link.write(line), deviceId.startsWith("usb:") ? BYTES_PER_USB_LINE : BYTES_PER_BLUETOOTH_LINE);
      await session.status();
      if (this.live.get(deviceId) !== boot || boot.generation !== generation) {
        throw new Error("This connection was replaced.");
      }
      boot.session = session;
      boot.close = () => link.close();
      this.updateBoot(deviceId, { paused: false, activity: "", failed: false });
      await this.refreshUploads(deviceId);
    } catch (error) {
      // Prevent closing a failed attempt from forgetting its retained row.
      if (boot.generation === generation) boot.generation++;
      await link.close().catch(() => undefined);
      throw error;
    }
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
    await this.reconnect(deviceId);
    if (this.live.get(deviceId) !== boot || boot.state.paused || boot.state.sending) return;
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
        failed: false,
        activity: result.alreadyThere ? `${recipe.name} was already on this boot, so it's selected now.` : `${recipe.name} is on the strip.`,
      });
      await this.refreshUploads(deviceId);
      this.updateBoot(deviceId, { sending: false });
    } else {
      this.updateBoot(deviceId, { sending: false, failed: true, activity: result.error });
    }
  }

  async deleteUpload(deviceId: string, name: string): Promise<void> {
    const boot = this.live.get(deviceId);
    if (!boot || boot.state.sending) return;
    await this.reconnect(deviceId);
    if (this.live.get(deviceId) !== boot || boot.state.paused || boot.state.sending) return;
    this.updateBoot(deviceId, { sending: true });
    const failure = await boot.session.deleteRecipe(name).catch((error: Error) => error.message);
    this.updateBoot(deviceId, { activity: failure ?? `Deleted ${name} from this boot.`, failed: failure !== null });
    await this.refreshUploads(deviceId);
    this.updateBoot(deviceId, { sending: false });
  }
}
