/**
 * Gives the designer access to the remote's labeled boots. BootsStore owns every
 * BootClient and physical connection; this adapter only adds recipe upload progress
 * and slot lists for BootPanel. Switching desktop sections never opens a second link.
 * BootSession owns recipe retries and compilation stays in the designer.
 */
import { BootsStore, type Side } from "../core/boots";
import type { BootClient } from "../core/boot";
import type { PickMethod } from "../transport/transport";
import { BootSession, BYTES_PER_BLUETOOTH_LINE, BYTES_PER_USB_LINE, RECIPE_PROTOCOL, type SendProgress } from "../../../designer/src/boot/bootSession";
import type { ConnectedBoot, ConnectionsState, DesignerBoots } from "../../../designer/src/boot/connections";
import { devServerPorts, type BootPortsClient, type PortHolder } from "../../../designer/src/boot/portHolders";
import { compileRecipe } from "../../../designer/src/recipe/compile";
import type { Recipe } from "../../../designer/src/recipe/types";

const progressText = (progress: SendProgress): string => progress.stage === "checking" ? "Checking the boot…"
  : progress.stage === "selecting" ? "Selecting it…" : `Sending ${progress.sent} of ${progress.total} bytes…`;

export class SharedBootConnections implements DesignerBoots {
  private listeners = new Set<() => void>();
  private details = new Map<string, Partial<ConnectedBoot>>();
  private state: ConnectionsState = {
    ready: false, pickers: [], error: null, hint: null, holders: [], freeing: null, connecting: false, boots: [],
  };

  constructor(readonly store: BootsStore, private readonly ports: BootPortsClient = devServerPorts) {
    store.subscribe(() => this.update());
    this.update();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): ConnectionsState => this.state;

  private update(changes: Partial<ConnectionsState> = {}): void {
    const boots = this.store.sides().flatMap((side): ConnectedBoot[] => {
      const known = this.store.known(side);
      const client = this.store.client(side);
      if (!known || !client) return [];
      const state = client.getState();
      return [{
        activity: "", failed: false, sending: false, uploads: null, slots: null,
        ...this.details.get(known.deviceId),
        deviceId: known.deviceId,
        name: `${this.store.displayName(side)} · ${this.store.bootName(side)}`,
        paused: state.link !== "online",
      }];
    });
    this.state = { ...this.state, ...changes, boots };
    for (const listener of this.listeners) listener();
  }

  private updateBoot(id: string, changes: Partial<ConnectedBoot>): void {
    this.details.set(id, { ...this.details.get(id), ...changes });
    this.update();
  }

  private side(id: string): Side | undefined {
    return this.store.sides().find((side) => this.store.known(side)?.deviceId === id);
  }

  private client(id: string): BootClient | undefined {
    const side = this.side(id);
    return side ? this.store.client(side) : undefined;
  }

  async prepare(): Promise<void> {
    // Initialize Bluetooth before a click needs its picker; USB remains usable
    // when the computer's Bluetooth is off or unavailable.
    await this.store.transport.radioState();
    const holders = await this.ports.list().catch(() => []);
    this.update({ ready: true, pickers: this.store.transport.pickers, holders: holders.filter((holder) => holder.kind !== "browser") });
    await Promise.all(this.state.boots.filter((boot) => !boot.paused && !boot.sending).map((boot) => this.refreshUploads(boot.deviceId)));
  }

  /** New boots take an unused side. Reaching a known boot over USB keeps its label. */
  async connect(method: PickMethod): Promise<void> {
    this.update({ connecting: true, error: null, hint: null });
    try {
      const found = await this.store.transport.pick(method);
      if (!found) return;
      const existing = this.store.sides().find((side) => {
        const known = this.store.known(side)!;
        return known.deviceId === found.deviceId || known.name === found.name;
      });
      const side = existing ?? (["left", "right"] as const).find((side) => !this.store.known(side));
      if (!side) throw new Error("Both boots are already labeled. Open Remote → Boots to replace one.");
      this.store.assign(found, side);
      await this.reconnect(found.deviceId);
      await this.refreshUploads(found.deviceId);
    } catch (error) {
      const holders = await this.ports.list().catch(() => []);
      this.update({ error: (error as Error).message, holders });
    } finally {
      this.update({ connecting: false });
    }
  }

  async free(holder: PortHolder): Promise<void> {
    this.update({ freeing: holder.pid, error: null });
    const result = await this.ports.free(holder.pid).catch((error: Error) => ({ freed: false, error: error.message }));
    this.update({ freeing: null, error: result.freed ? null : result.error ?? "Couldn't close that tool." });
    if (result.freed) await this.prepare();
  }

  async disconnect(id: string): Promise<void> {
    this.client(id)?.pause();
  }

  /** A Send after Disconnect waits for fresh status, including a firmware update or changed settings. */
  async reconnect(id: string): Promise<void> {
    try {
      await this.waitForConnection(id);
    } catch (error) {
      this.updateBoot(id, { failed: true, activity: (error as Error).message });
      throw error;
    }
  }

  private async waitForConnection(id: string): Promise<void> {
    const client = this.client(id);
    if (!client) throw new Error("This boot is no longer labeled.");
    client.connect();
    if (client.getState().link === "online") return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("Couldn't reconnect. Open Remote → Boots to check access.")), 10000);
      const unsubscribe = client.subscribe(() => {
        if (client.getState().link === "online") finish();
        else if (client.getState().link === "needs-access") finish(new Error("Pick this boot again in Remote → Boots."));
      });
      function finish(error?: Error) {
        clearTimeout(timer);
        unsubscribe();
        if (error) reject(error); else resolve();
      }
    });
  }

  private async exchange<T>(id: string, operation: (session: BootSession) => Promise<T>): Promise<T> {
    const client = this.client(id);
    if (!client) throw new Error("This boot is no longer labeled.");
    return client.runExclusive((exchange) => operation(new BootSession(exchange,
      id.startsWith("usb:") ? BYTES_PER_USB_LINE : BYTES_PER_BLUETOOTH_LINE)));
  }

  private async refreshUploads(id: string): Promise<void> {
    if ((this.client(id)?.getState().status?.proto ?? 0) < RECIPE_PROTOCOL) return;
    const reply = await this.exchange(id, (session) => session.recipes()).catch(() => null);
    if (reply) this.updateBoot(id, { uploads: reply.list as string[], slots: reply.slots as number });
  }

  async send(id: string, recipe: Recipe): Promise<void> {
    if (this.details.get(id)?.sending) return;
    const compiled = compileRecipe(recipe);
    if (!compiled.ok) {
      this.updateBoot(id, { failed: true, activity: compiled.errors.join(" ") });
      return;
    }
    this.updateBoot(id, { sending: true, failed: false, activity: "Connecting…" });
    try {
      await this.reconnect(id);
      const result = await this.exchange(id, (session) => session.sendRecipe(recipe.name, compiled.bytes,
        (progress) => this.updateBoot(id, { activity: progressText(progress) })));
      this.updateBoot(id, { failed: !result.ok, activity: result.ok ? `${recipe.name} is on the strip.` : result.error });
      await this.refreshUploads(id);
    } catch (error) {
      this.updateBoot(id, { failed: true, activity: (error as Error).message });
    } finally {
      this.updateBoot(id, { sending: false });
    }
  }

  async deleteUpload(id: string, name: string): Promise<void> {
    if (this.details.get(id)?.sending) return;
    this.updateBoot(id, { sending: true, failed: false });
    try {
      await this.reconnect(id);
      const failure = await this.exchange(id, (session) => session.deleteRecipe(name));
      this.updateBoot(id, { failed: failure !== null, activity: failure ?? `Deleted ${name} from this boot.` });
      await this.refreshUploads(id);
    } catch (error) {
      this.updateBoot(id, { failed: true, activity: (error as Error).message });
    } finally {
      this.updateBoot(id, { sending: false });
    }
  }
}
