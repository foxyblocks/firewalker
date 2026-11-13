/**
 * The patterns this phone keeps, and where each came from. Today that's main's patterns,
 * downloaded as the pattern catalog (catalog.ts) from the CDN, which pattern sync (patternSync.ts)
 * puts on every boot that connects. native.tsx refreshes it at launch and whenever the app returns
 * to the foreground.
 *
 * Main is canonical: whatever the newest catalog says replaces the last one wholesale. The library
 * keeps the last good catalog in storage, so the phone can still sync boots later with no signal.
 * A failed or broken download is silent and changes nothing.
 *
 * The library is shaped for a second origin, the person's own copies ("mine"), which an on-phone
 * designer will add. They get their own storage key (`LIBRARY_KEYS.mine`), so a catalog update can
 * never touch them, and `wantedRecipes` already says how the two combine.
 */

import { catalogFingerprint, parseCatalog, type Catalog } from "./catalog";
import type { KeyValueStore } from "./boots";

/**
 * Where a library pattern came from. "canonical" patterns are main's, from the catalog: read-only
 * on the phone and replaced wholesale by each newer catalog. "mine" are the person's own copies,
 * which a catalog update never touches (not built yet). When both have a name, canonical wins it.
 */
export type PatternOrigin = "canonical" | "mine";

/** What pattern sync needs to put one recipe on a boot. */
export interface WantedRecipe {
  name: string;
  origin: PatternOrigin;
  /** The recipe format version the bytes need, which is also their first byte. */
  recipeVersion: number;
  /** The compiled recipe, exactly as a boot stores it. */
  bytes: Uint8Array;
  /** The checksum a boot reports for these bytes in `recipe info`, as eight hex digits. */
  crc: string;
}

/** One pattern in the phone's library. */
export interface LibraryPattern extends WantedRecipe {
  description: string;
  /** The source recipe, as in patterns/<name>.json, for features that show a pattern's layers. */
  recipe: unknown;
}

/**
 * Where the library lives in the phone's storage (Capacitor Preferences on an iPhone). Each origin
 * has its own key, so replacing main's patterns can't touch the person's own.
 */
export const LIBRARY_KEYS = {
  /** The last good catalog, as the text the CDN served. */
  canonical: "library.canonical",
  /** Reserved for the person's own copies. Nothing writes it yet. */
  mine: "library.mine",
} as const;

/** Where the Publish pattern catalog workflow puts main's catalog (.github/workflows/publish-catalog.yml). */
export const CATALOG_URL = "https://cdn.foxyblocks.com/files/firewalker-catalog.json";

/** Fetches a URL's body as text, giving up after `timeoutMs`. transport/catalogFetch.ts has the real one. */
export type FetchText = (url: string, timeoutMs: number) => Promise<string>;

const FETCH_TIMEOUT_MS = 10000;

/**
 * The recipes pattern sync should put on a boot, in order: main's patterns, then the person's own.
 * Main's pattern wins a name both have, so a boot always runs main's version under that name.
 */
export function wantedRecipes(canonical: readonly LibraryPattern[], mine: readonly LibraryPattern[]): WantedRecipe[] {
  const taken = new Set(canonical.map((pattern) => pattern.name));
  return [...canonical, ...mine.filter((pattern) => !taken.has(pattern.name))];
}

export class PatternLibrary {
  private catalog: Catalog | null = null;
  private refreshing: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private readonly url: string;
  private readonly timeoutMs: number;

  /** `url` is where the catalog comes from: the CDN on a phone, the dev server in Chrome. */
  constructor(
    private readonly storage: KeyValueStore,
    private readonly fetchText: FetchText,
    { url = CATALOG_URL, timeoutMs = FETCH_TIMEOUT_MS }: { url?: string; timeoutMs?: number } = {},
  ) {
    this.url = url;
    this.timeoutMs = timeoutMs;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Changes whenever the library's patterns do, for useSyncExternalStore. */
  getVersion = (): number => this.version;

  private notify(): void {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  /** Reads the kept catalog. Call once at startup, before the first refresh. */
  async load(): Promise<void> {
    const text = await this.storage.get(LIBRARY_KEYS.canonical);
    const parsed = text === null ? null : parseCatalog(text);
    if (parsed?.ok) {
      this.catalog = parsed.catalog;
      this.notify();
    }
  }

  /**
   * Downloads the catalog and, if it's good and its patterns differ, keeps it and tells
   * subscribers. Never rejects. Calls that overlap share one download.
   */
  refresh(): Promise<void> {
    this.refreshing ??= this.download().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async download(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const text = await Promise.race([
        this.fetchText(this.url, this.timeoutMs),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("The catalog download timed out.")), this.timeoutMs);
        }),
      ]);
      const parsed = parseCatalog(text);
      if (!parsed.ok) return;
      const changed = this.catalog === null || catalogFingerprint(parsed.catalog) !== catalogFingerprint(this.catalog);
      await this.storage.set(LIBRARY_KEYS.canonical, text);
      this.catalog = parsed.catalog;
      if (changed) this.notify();
    } catch {
      // No signal, or the CDN is down: the kept copy carries on.
    } finally {
      clearTimeout(timer);
    }
  }

  /** Main's patterns, from the newest good catalog. Empty until one has been downloaded. */
  canonical(): readonly LibraryPattern[] {
    return this.catalog?.patterns ?? [];
  }

  /** The recipes pattern sync should put on every boot. */
  wanted(): WantedRecipe[] {
    return wantedRecipes(this.canonical(), []);
  }

  /** Identifies what `wanted()` holds, or null with nothing to sync yet. */
  fingerprint(): string | null {
    return this.catalog ? catalogFingerprint(this.catalog) : null;
  }

  /** Main's description of a pattern, for its tile. */
  description(name: string): string | undefined {
    return this.canonical().find((pattern) => pattern.name === name)?.description;
  }
}
