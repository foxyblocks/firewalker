/**
 * The pair of boots, and what a tap applies to. It owns one `BootClient` per side, the
 * Both, Left, or Right choice, and the labels saved on this phone. The Remote screen reads
 * from `view()` and calls the actions here. Status and Calibrate are about one boot at a
 * time, so they use its `BootClient` from `client(side)` directly.
 *
 * Left and Right exist only on the phone. Both boots run the same firmware and don't
 * know which foot they're on, so a boot's side is whatever you labeled it.
 *
 * "Both" is explicit fan-out: each boot gets its own command and reports its own
 * result. Nothing here syncs the boots, and a single-boot tab can't reach the other.
 */

import { BootClient, type BootState } from "./boot";
import { PROTOCOL_VERSION } from "./protocol";
import type { FoundBoot, Transport } from "../transport/transport";

export type Side = "left" | "right";
export type Target = "both" | Side;

const SIDES: Side[] = ["left", "right"];
export const SIDE_NAMES: Record<Side, string> = { left: "Left", right: "Right" };
const STORAGE_KEY = "boots";
const BLINK_CONNECT_WAIT_MS = 6000;
// Long enough to finish a blink that flips the lights off and back on.
const BLINK_HOLD_MS = 2500;

export interface KnownBoot {
  side: Side;
  deviceId: string;
  /** The advertised name, such as Firewalker-3ED1. */
  name: string;
  /** Your own name for this boot, replacing Left or Right. */
  nickname?: string;
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface PatternTile {
  id: string;
  /** Boots running this pattern, counting a tap that's still on its way. */
  runningOn: Side[];
  /** Chosen boots whose firmware doesn't have this pattern. */
  missingOn: Side[];
}

/** Everything the Remote screen shows, for whichever boots the current tab controls. */
export interface RemoteView {
  /** The boots this tab controls. */
  chosen: Side[];
  tiles: PatternTile[];
  on: boolean;
  brightness: number;
  maxBrightness: number;
  /** A pattern just chosen that some boots can't run. */
  needsUpdate?: { pattern: string; sides: Side[] };
  offline: Side[];
  /** Chosen boots this browser can't reach until they're picked again (`restoreAccess`). */
  accessLost: Side[];
  saving: boolean;
  saveFailed: Side[];
  sensorMissing: Side[];
  uncalibrated: Side[];
  noAnswer: Side[];
  /** Chosen boots whose firmware is too old for this app. */
  outdated: Side[];
  /** True when at least one chosen boot can take a command. */
  controllable: boolean;
}

export class BootsStore {
  target: Target = "both";
  ready = false;

  private knownBoots: KnownBoot[] = [];
  private readonly connections = new Map<Side, { client: BootClient; unsubscribe: () => void }>();
  /** Short-lived connections to unlabeled boots, for Blink. Labeling one adopts it. */
  private readonly blinking = new Map<string, BootClient>();
  private readonly listeners = new Set<() => void>();
  private needsUpdate: RemoteView["needsUpdate"];
  private version = 0;

  constructor(
    readonly transport: Transport,
    private readonly storage: KeyValueStore,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Changes whenever anything a screen shows has changed, for useSyncExternalStore. */
  getVersion = (): number => this.version;

  private notify(): void {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  /** Reads the saved boots and starts connecting to them. Call once at startup. */
  async load(): Promise<void> {
    const saved = await this.storage.get(STORAGE_KEY);
    this.knownBoots = saved ? (JSON.parse(saved) as KnownBoot[]) : [];
    for (const boot of this.knownBoots) this.startClient(boot);
    this.fixTarget();
    this.ready = true;
    this.notify();
  }

  private persist(): void {
    void this.storage.set(STORAGE_KEY, JSON.stringify(this.knownBoots));
  }

  private startClient(boot: KnownBoot): void {
    const client = this.blinking.get(boot.deviceId) ?? new BootClient(this.transport, boot.deviceId);
    this.blinking.delete(boot.deviceId);
    this.connections.set(boot.side, { client, unsubscribe: client.subscribe(() => this.notify()) });
    client.connect();
  }

  private stopClient(side: Side): void {
    const connection = this.connections.get(side);
    connection?.unsubscribe();
    this.connections.delete(side);
    void connection?.client.disconnect();
  }

  /** Both only makes sense with two boots, and a tab needs a boot behind it. */
  private fixTarget(): void {
    const sides = this.sides();
    if (sides.length === 2) {
      if (this.target !== "both" && !sides.includes(this.target)) this.target = "both";
      return;
    }
    this.target = sides[0] ?? "both";
  }

  sides(): Side[] {
    return SIDES.filter((side) => this.knownBoots.some((boot) => boot.side === side));
  }

  known(side: Side): KnownBoot | undefined {
    return this.knownBoots.find((boot) => boot.side === side);
  }

  client(side: Side): BootClient | undefined {
    return this.connections.get(side)?.client;
  }

  /**
   * The boot's own name, such as Firewalker-3EB5. Its status has the real id, so this is
   * right even if the scan saw the boot before its name arrived.
   */
  bootName(side: Side): string {
    const id = this.client(side)?.getState().status?.id;
    return id ? `Firewalker-${id}` : (this.known(side)?.name ?? "Firewalker");
  }

  displayName(side: Side): string {
    return this.known(side)?.nickname ?? SIDE_NAMES[side];
  }

  /**
   * Labels a boot and connects to it. Giving it the other boot's side swaps the two,
   * and a new boot on a taken side replaces the old one, so a side never has two boots.
   */
  assign(found: FoundBoot, side: Side): void {
    const existing = this.knownBoots.find((boot) => boot.deviceId === found.deviceId);
    const occupant = this.known(side);
    if (existing && existing.side === side) return;

    if (existing && occupant) {
      // A swap keeps both connections up and only changes which side each one is on.
      const existingConnection = this.connections.get(existing.side)!;
      const occupantConnection = this.connections.get(side)!;
      this.connections.set(side, existingConnection);
      this.connections.set(existing.side, occupantConnection);
      occupant.side = existing.side;
      existing.side = side;
    } else if (existing) {
      const connection = this.connections.get(existing.side)!;
      this.connections.delete(existing.side);
      this.connections.set(side, connection);
      existing.side = side;
    } else {
      if (occupant) this.removeBoot(side);
      const boot: KnownBoot = { side, deviceId: found.deviceId, name: found.name };
      this.knownBoots.push(boot);
      this.startClient(boot);
      // Adding the second boot is the moment you'd want to control the pair.
      if (this.sides().length === 2) this.target = "both";
    }

    this.fixTarget();
    this.persist();
    this.notify();
  }

  /**
   * Shows the system picker to get a boot back after a browser lost access to it, so this has
   * to run from a tap. The picked boot's name says which saved boot it is, because the browser
   * can hand out a new handle, and the boot keeps its side and your name for it. A boot that
   * isn't one of yours is ignored, since Boots is where new ones get labeled.
   */
  async restoreAccess(): Promise<void> {
    const found = await this.transport.pick();
    const boot = found && this.knownBoots.find((candidate) => candidate.name === found.name);
    if (!found || !boot) return;
    this.stopClient(boot.side);
    boot.deviceId = found.deviceId;
    this.persist();
    this.startClient(boot);
    this.notify();
  }

  private removeBoot(side: Side): void {
    this.stopClient(side);
    this.knownBoots = this.knownBoots.filter((boot) => boot.side !== side);
  }

  /**
   * Blinks a boot so you can tell which physical one a list row means. A boot with no
   * label yet has no connection, so this makes a short-lived one and lets it go, since
   * each boot only accepts one connection at a time. Labeling the boot mid-blink keeps
   * that connection rather than dropping it and connecting again.
   */
  async blinkFound(found: FoundBoot): Promise<void> {
    const existing = this.knownBoots.find((boot) => boot.deviceId === found.deviceId);
    if (existing) {
      this.client(existing.side)?.blink();
      return;
    }
    const client = new BootClient(this.transport, found.deviceId);
    this.blinking.set(found.deviceId, client);
    await new Promise<void>((resolve) => {
      const giveUp = setTimeout(finish, BLINK_CONNECT_WAIT_MS);
      const unsubscribe = client.subscribe(() => {
        if (client.getState().link === "online") finish();
      });
      function finish() {
        clearTimeout(giveUp);
        unsubscribe();
        resolve();
      }
      client.connect();
    });
    client.blink();
    await new Promise((resolve) => setTimeout(resolve, BLINK_HOLD_MS));
    if (this.blinking.get(found.deviceId) !== client) return;
    this.blinking.delete(found.deviceId);
    await client.disconnect();
  }

  /** Forgets a boot and disconnects from it. The boot keeps running what it's running. */
  forget(side: Side): void {
    this.removeBoot(side);
    this.fixTarget();
    this.persist();
    this.notify();
  }

  /** Gives a boot your own name. A blank name goes back to Left or Right. */
  rename(side: Side, name: string): void {
    const boot = this.known(side);
    if (!boot) return;
    const nickname = name.trim();
    if (nickname) boot.nickname = nickname;
    else delete boot.nickname;
    this.persist();
    this.notify();
  }

  setTarget(target: Target): void {
    this.target = target;
    this.needsUpdate = undefined;
    this.notify();
  }

  /** Call when the app returns to the foreground. */
  resume(): void {
    this.connections.forEach(({ client }) => client.resume());
  }

  /** The sides the current tab controls. */
  targetSides(): Side[] {
    return this.target === "both" ? this.sides() : this.sides().filter((side) => side === this.target);
  }

  /**
   * The boots Calibrate can walk through: chosen, online, and with a working sensor. A boot
   * that can't capture would otherwise block the flow for the one that can.
   */
  calibrationSides(): Side[] {
    return this.onlineTargets()
      .filter(({ state }) => state.status?.sensor === "ok")
      .map(({ side }) => side);
  }

  private onlineTargets(): { side: Side; client: BootClient; state: BootState }[] {
    return this.targetSides().flatMap((side) => {
      const client = this.client(side);
      return client && client.getState().link === "online"
        ? [{ side, client, state: client.getState() }]
        : [];
    });
  }

  /**
   * Selects a pattern on every chosen boot that has it. A boot without it stays as it
   * is, and the view names that boot so you know why it didn't change.
   */
  selectPattern(pattern: string): void {
    const missing: Side[] = [];
    for (const { side, client, state } of this.onlineTargets()) {
      if (state.patterns.includes(pattern)) client.setPattern(pattern);
      else missing.push(side);
    }
    this.needsUpdate = missing.length > 0 ? { pattern, sides: missing } : undefined;
    this.notify();
  }

  setPower(on: boolean): void {
    this.onlineTargets().forEach(({ client }) => client.setPower(on));
  }

  setBrightness(level: number): void {
    this.onlineTargets().forEach(({ client }) => client.setBrightness(level));
  }

  setDragging(dragging: boolean): void {
    this.onlineTargets().forEach(({ client }) => client.setDragging(dragging));
  }

  /**
   * Everything the Remote screen shows for the current tab: what the chosen boots last
   * reported, plus any taps still on their way. An offline boot keeps its pattern tiles so
   * the screen doesn't go empty while it reconnects, but it can't be running one.
   */
  view(): RemoteView {
    const chosen = this.targetSides().flatMap((side) => {
      const client = this.client(side);
      return client ? [{ side, state: client.getState() }] : [];
    });
    const online = chosen.filter(({ state }) => state.link === "online" && state.status);
    const sidesWhere = (test: (state: BootState) => boolean) =>
      chosen.filter(({ state }) => test(state)).map(({ side }) => side);

    // The union, in the order each boot reports, so Both shows everything either has.
    const reported = chosen.filter(({ state }) => state.status);
    const patternIds = [...new Set(reported.flatMap(({ state }) => state.patterns))];
    const tiles: PatternTile[] = patternIds.map((id) => ({
      id,
      runningOn: online.filter(({ state }) => shownPattern(state) === id).map(({ side }) => side),
      missingOn: online.filter(({ state }) => !state.patterns.includes(id)).map(({ side }) => side),
    }));

    const first = online[0]?.state;
    return {
      chosen: chosen.map(({ side }) => side),
      tiles,
      on: online.some(({ state }) => shownOn(state)),
      brightness: first?.pending.brightness ?? first?.status?.brightness ?? 0,
      maxBrightness: online.length > 0 ? Math.min(...online.map(({ state }) => state.status!.maxBrightness)) : 0,
      needsUpdate: this.needsUpdate,
      offline: sidesWhere((state) => state.link !== "online" && state.link !== "needs-access"),
      accessLost: sidesWhere((state) => state.link === "needs-access"),
      saving: online.some(({ state }) => state.status!.saved === false && !state.status!.saveFailed),
      saveFailed: sidesWhere((state) => state.link === "online" && state.status?.saveFailed === true),
      sensorMissing: sidesWhere((state) => state.link === "online" && state.status?.sensor === "unavailable"),
      uncalibrated: sidesWhere((state) => state.link === "online" && state.status?.calibrated === false),
      noAnswer: sidesWhere((state) => state.notice === "no-answer"),
      outdated: sidesWhere((state) => state.status !== undefined && (state.status.proto ?? 0) < PROTOCOL_VERSION),
      controllable: online.length > 0,
    };
  }
}

/** The pattern to show for a boot: a tap on its way, or what it last reported. */
function shownPattern(state: BootState): string | undefined {
  if (state.pending.pattern !== undefined) return state.pending.pattern;
  if (state.pending.power === false) return "off";
  if (state.pending.power === true) return state.status?.lit;
  return state.status?.pattern;
}

function shownOn(state: BootState): boolean {
  if (state.pending.power !== undefined) return state.pending.power;
  if (state.pending.pattern !== undefined) return true;
  return state.status?.pattern !== "off";
}
