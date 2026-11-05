// The designer's pattern library. Saved recipes come from the repo's patterns/ folder through
// the dev server. Every edit lands in a draft in this browser's local storage, and only Save
// writes a file. A draft remembers which file it came from (`savedAs`), so a rename saves as a
// move rather than a copy. It also remembers that file's version when the draft started
// (`baseVersion`), so if the file then changes, for example in a git pull, the pattern reports a
// conflict and Save won't overwrite the file unless told to.

import { recipeToJson } from "../recipe/serialize";
import { withDefaults } from "../recipe/spec";
import { MAX_NAME_LENGTH, type Recipe } from "../recipe/types";
import { nameProblem, validateRecipe } from "../recipe/validate";

export type PatternStatus = "saved" | "changed" | "new";
// What happened to a draft's file after the draft started. Null when nothing has.
export type FileConflict = "changed" | "deleted" | null;

export interface PatternEntry {
  name: string;
  recipe: Recipe;
  savedAs: string | null;
  status: PatternStatus;
  problems: string[];
  conflict: FileConflict;
}

export interface BrokenFile {
  name: string;
  errors: string[];
}

export interface LibraryState {
  loading: boolean;
  // False when the dev server's patterns API isn't reachable, for example in a static build.
  repoAvailable: boolean;
  repoDir: string | null;
  entries: PatternEntry[];
  broken: BrokenFile[];
}

interface Draft {
  recipe: Recipe;
  savedAs: string | null;
  updatedAt: number;
  // The file's version when this draft started, or null if no file existed. Drafts from before
  // versions existed don't have one, so they save without a check.
  baseVersion?: string | null;
}

const DRAFTS_KEY = "firewalker-designer:drafts:v1";
const API = "/api/patterns";

export class PatternLibrary {
  private repo = new Map<string, Recipe>();
  // Every readable file's version, including files too broken to be in `repo`.
  private versions = new Map<string, string>();
  // The last list from the server, to tell whether a refresh found anything new.
  private lastRepoText: string | null = null;
  private broken: BrokenFile[] = [];
  private drafts: Record<string, Draft>;
  private loading = true;
  private repoAvailable = false;
  private repoDir: string | null = null;
  private listeners = new Set<() => void>();
  private snapshot: LibraryState;

  constructor(private readonly storage: Storage | null = safeLocalStorage()) {
    this.drafts = this.readDrafts();
    this.snapshot = this.buildSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LibraryState => this.snapshot;

  async load(): Promise<void> {
    this.loading = true;
    this.emit();
    await this.fetchRepo();
    this.loading = false;
    this.emit();
  }

  // Picks up changes made outside the designer, such as a git pull. It's quiet: nothing shows
  // as loading, and nothing updates unless the files really changed.
  async refresh(): Promise<void> {
    if (!this.loading && (await this.fetchRepo())) this.emit();
  }

  // Reads the patterns folder through the dev server. Returns whether anything changed.
  private async fetchRepo(): Promise<boolean> {
    try {
      const response = await fetch(API);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (this.repoAvailable && text === this.lastRepoText) return false;
      const body = JSON.parse(text) as { dir: string; patterns: { name: string; recipe: Recipe | null; version?: string; errors?: string[] }[] };
      this.repo = new Map(body.patterns.filter((p) => p.recipe).map((p) => [p.name, p.recipe!]));
      this.versions = new Map(body.patterns.filter((p) => p.version).map((p) => [p.name, p.version!]));
      this.broken = body.patterns.filter((p) => !p.recipe).map((p) => ({ name: p.name, errors: p.errors ?? [] }));
      this.repoAvailable = true;
      this.repoDir = body.dir;
      this.lastRepoText = text;
      this.dropDraftsThatMatchTheirFile();
      return true;
    } catch {
      const wasAvailable = this.repoAvailable;
      this.repoAvailable = false;
      return wasAvailable;
    }
  }

  // A pull can bring in the very change a draft holds, and then there's nothing left to save.
  private dropDraftsThatMatchTheirFile(): void {
    let dropped = false;
    for (const [name, draft] of Object.entries(this.drafts)) {
      const saved = this.repo.get(name);
      if (saved && (draft.savedAs ?? name) === name && sameRecipe(saved, draft.recipe)) {
        delete this.drafts[name];
        dropped = true;
      }
    }
    if (dropped) this.writeDrafts();
  }

  entry(name: string): PatternEntry | undefined {
    return this.snapshot.entries.find((e) => e.name === name);
  }

  // Names in use, including saved files a draft has renamed away from but not yet saved.
  isTaken(name: string): boolean {
    return this.repo.has(name) || name in this.drafts || this.snapshot.entries.some((e) => e.name === name);
  }

  uniqueName(base: string): string {
    const stem = base.slice(0, MAX_NAME_LENGTH);
    if (!this.isTaken(stem) && !nameProblem(stem)) return stem;
    for (let n = 2; n < 1000; n++) {
      const suffix = `-${n}`;
      const candidate = `${stem.slice(0, MAX_NAME_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
      if (!this.isTaken(candidate) && !nameProblem(candidate)) return candidate;
    }
    throw new Error("No free name.");
  }

  create(recipe: Recipe): string {
    const name = this.uniqueName(recipe.name);
    this.drafts[name] = { recipe: { ...recipe, name }, savedAs: null, updatedAt: Date.now(), baseVersion: null };
    this.commit();
    return name;
  }

  duplicate(name: string): string | null {
    const entry = this.entry(name);
    if (!entry) return null;
    return this.create(structuredClone(entry.recipe));
  }

  // Records an edit. An edit that lands back on the saved version drops the draft.
  update(name: string, recipe: Recipe): void {
    const entry = this.entry(name);
    if (!entry) return;
    const next = { ...recipe, name };
    const saved = entry.savedAs ? this.repo.get(entry.savedAs) : undefined;
    if (saved && entry.savedAs === name && recipeToJson(saved) === recipeToJson(next)) {
      delete this.drafts[name];
    } else {
      this.drafts[name] = { recipe: next, savedAs: entry.savedAs, updatedAt: Date.now(), baseVersion: this.baseVersionFor(name, entry) };
    }
    this.commit();
  }

  // Returns a reason the rename can't happen, or null once it has.
  rename(name: string, newName: string): string | null {
    if (newName === name) return null;
    const problem = nameProblem(newName);
    if (problem) return problem;
    const entry = this.entry(name);
    if (!entry) return "That pattern no longer exists.";
    if (this.isTaken(newName) && newName !== entry.savedAs) return `A pattern named "${newName}" already exists.`;
    const baseVersion = this.baseVersionFor(name, entry);
    delete this.drafts[name];
    this.drafts[newName] = { recipe: { ...entry.recipe, name: newName }, savedAs: entry.savedAs, updatedAt: Date.now(), baseVersion };
    this.commit();
    return null;
  }

  // Drops the draft, back to the saved file. A pattern that was never saved goes away.
  discard(name: string): void {
    delete this.drafts[name];
    this.commit();
  }

  // Writes the pattern to patterns/<name>.json. Returns the problems if it couldn't. It won't
  // overwrite a file that changed after the draft started unless `overwrite` says to. When that
  // stops a save, the entry's `conflict` shows why, and the caller can offer the choice.
  async save(name: string, { overwrite = false }: { overwrite?: boolean } = {}): Promise<string[]> {
    const entry = this.entry(name);
    if (!entry) return ["That pattern no longer exists."];
    const result = validateRecipe(entry.recipe);
    if (!result.ok) return result.errors;
    if (!this.repoAvailable) return ["Saving to the repo needs the designer's dev server (bun run dev)."];

    const params = new URLSearchParams();
    if (entry.savedAs && entry.savedAs !== name) params.set("replaces", entry.savedAs);
    const expected = overwrite ? undefined : this.baseVersionFor(name, entry);
    if (expected !== undefined) params.set("expected", expected ?? "none");
    const query = params.size > 0 ? `?${params}` : "";
    const response = await fetch(`${API}/${encodeURIComponent(name)}${query}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: recipeToJson(entry.recipe),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; errors?: string[]; version?: string };
    if (response.status === 409) await this.refresh();
    if (!response.ok) return body.errors?.length ? body.errors : [body.error ?? `Save failed (HTTP ${response.status}).`];

    if (entry.savedAs && entry.savedAs !== name) {
      this.repo.delete(entry.savedAs);
      this.versions.delete(entry.savedAs);
    }
    this.repo.set(name, entry.recipe);
    if (body.version) this.versions.set(name, body.version);
    this.lastRepoText = null;
    delete this.drafts[name];
    this.commit();
    return [];
  }

  // Deletes the pattern's file, if it has one, and its draft.
  async remove(name: string): Promise<string | null> {
    const entry = this.entry(name);
    if (!entry) return null;
    if (entry.savedAs) {
      if (!this.repoAvailable) return "Deleting a saved pattern needs the designer's dev server.";
      const response = await fetch(`${API}/${encodeURIComponent(entry.savedAs)}`, { method: "DELETE" });
      if (!response.ok) return `Delete failed (HTTP ${response.status}).`;
      this.repo.delete(entry.savedAs);
      this.versions.delete(entry.savedAs);
      this.lastRepoText = null;
    }
    delete this.drafts[name];
    this.commit();
    return null;
  }

  // The version a draft of this entry is working from: its own if it has a draft, or else the
  // file's current one, since an edit starting now starts from what's on disk now.
  private baseVersionFor(name: string, entry: PatternEntry): string | null | undefined {
    const draft = this.drafts[name];
    if (draft) return draft.baseVersion;
    return entry.savedAs ? this.versions.get(entry.savedAs) : null;
  }

  private conflictFor(name: string, draft: Draft): FileConflict {
    if (this.loading || !this.repoAvailable || draft.baseVersion === undefined) return null;
    const file = draft.savedAs ?? name;
    // A rename onto a name that now has its own file would overwrite that file.
    if (file !== name && this.versions.has(name)) return "changed";
    const current = this.versions.get(file);
    if (draft.baseVersion === null) return current === undefined ? null : "changed";
    if (current === undefined) return "deleted";
    return current === draft.baseVersion ? null : "changed";
  }

  private commit(): void {
    this.writeDrafts();
    this.emit();
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private buildSnapshot(): LibraryState {
    const entries: PatternEntry[] = [];
    const draftFor = new Map<string, [string, Draft]>();
    for (const [name, draft] of Object.entries(this.drafts)) {
      // A new draft belongs to a same-named file that has appeared since, so one name is one entry.
      const file = draft.savedAs ?? name;
      if (this.repo.has(file)) draftFor.set(file, [name, draft]);
    }

    for (const [file, recipe] of this.repo) {
      const draft = draftFor.get(file);
      if (draft) {
        entries.push(makeEntry(draft[0], draft[1].recipe, file, "changed", this.conflictFor(draft[0], draft[1])));
      } else if (!this.drafts[file]) {
        // A draft renamed onto this file's name stands in for it until its conflict is settled.
        entries.push(makeEntry(file, recipe, file, "saved", null));
      }
    }
    for (const [name, draft] of Object.entries(this.drafts)) {
      if (this.repo.has(draft.savedAs ?? name)) continue;
      // While the repo is still loading, or unreachable, a draft of a saved file shows as changed.
      const status: PatternStatus = draft.savedAs && (this.loading || !this.repoAvailable) ? "changed" : "new";
      entries.push(makeEntry(name, draft.recipe, status === "new" ? null : draft.savedAs, status, this.conflictFor(name, draft)));
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    return {
      loading: this.loading,
      repoAvailable: this.repoAvailable,
      repoDir: this.repoDir,
      entries,
      broken: this.broken,
    };
  }

  private readDrafts(): Record<string, Draft> {
    try {
      const raw = this.storage?.getItem(DRAFTS_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, Draft>) : {};
      if (typeof parsed !== "object" || parsed === null) return {};
      for (const draft of Object.values(parsed)) {
        if (draft && typeof draft === "object") draft.recipe = withDefaults(draft.recipe) as Recipe;
      }
      return parsed;
    } catch {
      return {};
    }
  }

  private writeDrafts(): void {
    try {
      this.storage?.setItem(DRAFTS_KEY, JSON.stringify(this.drafts));
    } catch {
      // Storage can be full or blocked. The edit still applies for this session.
    }
  }
}

function makeEntry(name: string, recipe: Recipe, savedAs: string | null, status: PatternStatus, conflict: FileConflict): PatternEntry {
  const result = validateRecipe(recipe);
  return { name, recipe, savedAs, status, problems: result.ok ? [] : result.errors, conflict };
}

// A draft restored from storage can be any shape, so a failure to compare just means "different".
function sameRecipe(a: Recipe, b: Recipe): boolean {
  try {
    return recipeToJson(a) === recipeToJson(b);
  } catch {
    return false;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
