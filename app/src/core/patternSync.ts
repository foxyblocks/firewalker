/**
 * Keeps each boot's uploaded patterns in step with main. When a labeled boot comes online (and
 * again whenever a newer catalog arrives while it's connected), this asks the boot what it has,
 * plans the changes with syncPlan.ts, and carries them out: delete what this phone synced before
 * that main dropped, then upload what's new or changed. It never selects a pattern, so the strip
 * keeps running what it was running, apart from what an upload itself does.
 *
 * Collaborators:
 * - `BootsStore` (boots.ts) says which boots exist and owns each one's `BootClient`.
 * - `PatternLibrary` (patternLibrary.ts) supplies the wanted recipes and says when they change.
 * - `BootSession` (shared/bootSession.ts) does the line-by-line recipe exchange, with retries.
 * - Storage keeps, per boot, the names this phone put there (`onBootKey`), so a later sync can
 *   tell its own uploads, which it may delete, from designer experiments, which it never touches.
 *
 * Each step takes its own turn in the boot's command queue (`BootClient.runExclusive`), so a tap on
 * brightness or a pattern slots in between two recipes instead of waiting for the whole sync.
 * `pause` holds a boot's sync between steps, for anything else that needs the boot's queue for a
 * while. Only the iPhone build turns sync on (native.tsx); the desktop app leaves boots to the
 * designer, but could construct one of these to opt in.
 */

import { BootSession, bytesPerLineFor, RECIPE_PROTOCOL, type RecipeInfo } from "../../../shared/bootSession";
import type { BootClient } from "./boot";
import type { BootsStore, KeyValueStore, Side } from "./boots";
import type { PatternLibrary, PatternOrigin, WantedRecipe } from "./patternLibrary";
import { isObject } from "./protocol";
import { planSync, recordAfterSync, type BootRecipes, type OnBootRecord } from "./syncPlan";

/** The storage key holding what this phone has put on one boot, by the boot's own id (status `id`). */
export const onBootKey = (bootId: string): string => `library.onBoot.${bootId}`;

/** Where one boot's sync stands. */
export interface BootSyncState {
  /**
   * "checking" while it asks the boot what it has, "syncing" while it changes something, "done"
   * once finished, and "failed" if a step failed or the boot went away partway.
   */
  phase: "checking" | "syncing" | "done" | "failed";
  /** Deletes and uploads finished so far, out of `total`. */
  done: number;
  total: number;
  /** Wanted recipes held back because this boot's firmware can't read them. */
  needsFirmware: number;
  /** Wanted recipes left off because this boot's slots ran out. */
  noRoom: number;
  /** Why it failed, when it did. */
  error?: string;
}

/** What the Remote screen shows about sync for the boots a tab controls. */
export interface SyncView {
  /**
   * Progress while any of them is changing something. With both boots syncing, it follows the one
   * with the most left to do, so the pair reads "3 of 7" rather than adding up to 14 steps.
   */
  progress?: { done: number; total: number };
  needsFirmware: { side: Side; count: number }[];
  noRoom: { side: Side; count: number }[];
  /** Boots still connected whose last sync failed. */
  failed: { side: Side; error: string }[];
}

/** Sync bookkeeping for one boot's client, which lives as long as the boot stays labeled. */
interface Track {
  /** The catalog this connection has synced, or started to. Cleared when the link drops. */
  attempted: string | null;
  running: boolean;
  state?: BootSyncState;
  paused: boolean;
  /** Steps waiting for `resume`. */
  waiting: (() => void)[];
}

export class PatternSync {
  private readonly tracks = new WeakMap<BootClient, Track>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private readonly store: BootsStore,
    readonly library: PatternLibrary,
    private readonly storage: KeyValueStore,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Changes whenever a sync's state or the library does, for useSyncExternalStore. */
  getVersion = (): number => this.version;

  private notify(): void {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  /** Starts watching boots and the library. Returns the function that stops it. */
  start(): () => void {
    const unsubscribeStore = this.store.subscribe(() => this.check());
    const unsubscribeLibrary = this.library.subscribe(() => {
      this.notify();
      this.check();
    });
    this.check();
    return () => {
      unsubscribeStore();
      unsubscribeLibrary();
    };
  }

  /** Where a boot's sync stands, or undefined if it hasn't started on this boot. */
  state(side: Side): BootSyncState | undefined {
    const client = this.store.client(side);
    return client ? this.tracks.get(client)?.state : undefined;
  }

  /**
   * Holds this boot's sync: a step already running finishes, and no new one starts, not even the
   * first check of a new sync, until `resume`. The other boot carries on.
   */
  pause(side: Side): void {
    const client = this.store.client(side);
    if (client) this.track(client).paused = true;
  }

  /** Lets a paused boot's sync carry on from where its plan stands. */
  resume(side: Side): void {
    const client = this.store.client(side);
    const track = client && this.tracks.get(client);
    if (!track) return;
    track.paused = false;
    track.waiting.splice(0).forEach((carryOn) => carryOn());
    this.check();
  }

  view(sides: readonly Side[]): SyncView {
    const view: SyncView = { needsFirmware: [], noRoom: [], failed: [] };
    for (const side of sides) {
      const state = this.state(side);
      if (!state) continue;
      const left = state.total - state.done;
      if (state.phase === "syncing" && left > 0 && (!view.progress || left > view.progress.total - view.progress.done)) {
        view.progress = { done: state.done, total: state.total };
      }
      if (state.needsFirmware > 0) view.needsFirmware.push({ side, count: state.needsFirmware });
      if (state.noRoom > 0) view.noRoom.push({ side, count: state.noRoom });
      // A boot that dropped mid-sync shows as reconnecting, and syncs again once it's back.
      if (state.phase === "failed" && state.error && this.store.client(side)?.getState().link === "online") {
        view.failed.push({ side, error: state.error });
      }
    }
    return view;
  }

  private track(client: BootClient): Track {
    let track = this.tracks.get(client);
    if (!track) {
      track = { attempted: null, running: false, paused: false, waiting: [] };
      this.tracks.set(client, track);
    }
    return track;
  }

  /**
   * Starts a sync on every boot that's online, can take recipes, and hasn't synced this catalog
   * on its current connection. Called on every store and library change, so it's cheap when
   * there's nothing to do.
   */
  private check(): void {
    const fingerprint = this.library.fingerprint();
    for (const side of this.store.sides()) {
      const client = this.store.client(side);
      if (!client) continue;
      const track = this.track(client);
      const { link, status } = client.getState();
      if (link !== "online") {
        // The next connection syncs again: the boot may have changed while it was away.
        track.attempted = null;
        continue;
      }
      if (!status || (status.proto ?? 0) < RECIPE_PROTOCOL || fingerprint === null) continue;
      if (track.running || track.attempted === fingerprint) continue;
      track.attempted = fingerprint;
      track.running = true;
      // Only storage can throw past syncBoot's own handling.
      void this.syncBoot(client, track, status.id).catch((error: unknown) => this.fail(track, error)).finally(() => {
        track.running = false;
        // A newer catalog may have arrived meanwhile.
        this.check();
      });
    }
  }

  private setState(track: Track, state: BootSyncState): void {
    track.state = state;
    this.notify();
  }

  /** Marks this boot's sync failed, keeping what's known so far, such as its counts. */
  private fail(track: Track, error: unknown): void {
    const known = track.state ?? { done: 0, total: 0, needsFirmware: 0, noRoom: 0 };
    this.setState(track, { ...known, phase: "failed", error: error instanceof Error ? error.message : String(error) });
  }

  /** Waits while this boot is paused. */
  private async whenResumed(track: Track): Promise<void> {
    if (!track.paused) return;
    await new Promise<void>((resolve) => track.waiting.push(resolve));
  }

  /** One sync of one boot: check, plan, delete, upload, then remember what's there. */
  private async syncBoot(client: BootClient, track: Track, bootId: string): Promise<void> {
    const wanted = this.library.wanted();
    // One turn in the boot's command queue.
    const step = async <T>(operation: (session: BootSession) => Promise<T>): Promise<T> => {
      await this.whenResumed(track);
      return client.runExclusive((exchange) => operation(new BootSession(exchange, bytesPerLineFor(client.deviceId))));
    };
    // Keep the last counts while checking, so a notice doesn't flicker off and back on.
    this.setState(track, { phase: "checking", done: 0, total: 0, needsFirmware: track.state?.needsFirmware ?? 0, noRoom: track.state?.noRoom ?? 0 });

    let boot: BootRecipes;
    try {
      boot = await step((session) => askBoot(session, wanted));
    } catch (error) {
      this.fail(track, error);
      return;
    }
    const record = await this.loadRecord(bootId);
    const plan = planSync(wanted, boot, record);
    const total = plan.deletes.length + plan.uploads.length;
    const state: BootSyncState = { phase: total > 0 ? "syncing" : "done", done: 0, total, needsFirmware: plan.needsFirmware.length, noRoom: plan.noRoom.length };
    this.setState(track, state);

    // Deletes first, so they free slots. Each step returns why it failed, or null.
    const work: { name: string; run: (session: BootSession) => Promise<string | null> }[] = [
      ...plan.deletes.map((name) => ({ name, run: (session: BootSession) => session.deleteRecipe(name) })),
      ...plan.uploads.map(({ name, bytes }) => ({ name, run: (session: BootSession) => session.uploadRecipe(name, bytes) })),
    ];
    const succeeded: string[] = [];
    let error: string | null = null;
    for (const item of work) {
      try {
        const failure = await step(item.run);
        if (failure) error = failure;
        else succeeded.push(item.name);
      } catch (thrown) {
        // The boot went away. What finished is still worth remembering; the rest waits for the
        // next connection.
        error = (thrown as Error).message;
        break;
      }
      this.setState(track, { ...state, done: succeeded.length });
    }

    await this.saveRecord(bootId, recordAfterSync(record, plan, boot, succeeded));
    if (error) this.fail(track, error);
    else this.setState(track, { ...state, phase: "done", done: succeeded.length });
  }

  private async loadRecord(bootId: string): Promise<OnBootRecord> {
    const text = await this.storage.get(onBootKey(bootId));
    if (!text) return {};
    try {
      const value: unknown = JSON.parse(text);
      if (!isObject(value)) return {};
      return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, PatternOrigin] => entry[1] === "canonical" || entry[1] === "mine"),
      );
    } catch {
      return {};
    }
  }

  private async saveRecord(bootId: string, record: OnBootRecord): Promise<void> {
    await this.storage.set(onBootKey(bootId), JSON.stringify(record));
  }
}

/**
 * Asks a boot what it has uploaded: the `recipes` reply, then `recipe info` for each upload a
 * wanted recipe would replace, since only those need comparing. Recipes the boot's firmware can't
 * read are held back whatever it has, so those go unasked.
 */
async function askBoot(session: BootSession, wanted: readonly WantedRecipe[]): Promise<BootRecipes> {
  const reply = await session.recipes();
  const versions = Array.isArray(reply.versions) ? reply.versions.filter((value): value is number => typeof value === "number") : [];
  const list = Array.isArray(reply.list) ? reply.list.filter((value): value is string => typeof value === "string") : [];
  const free = typeof reply.free === "number" ? reply.free : 0;
  const wantedNames = new Set(wanted.filter((recipe) => versions.includes(recipe.recipeVersion)).map((recipe) => recipe.name));
  const uploads: Record<string, RecipeInfo | null> = {};
  for (const name of list) {
    uploads[name] = wantedNames.has(name) ? await session.recipeInfo(name).catch(() => null) : null;
  }
  return { versions, free, uploads };
}
