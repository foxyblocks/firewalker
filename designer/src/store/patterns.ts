// The designer's pattern library. Saved recipes come from the repo's patterns/ folder through
// the dev server. Every edit lands in a draft in this browser's local storage, and only Save
// writes a file. A draft remembers which file it came from (`savedAs`), so a rename saves as a
// move rather than a copy.

import { recipeToJson } from "../recipe/serialize";
import { withDefaults } from "../recipe/spec";
import { MAX_NAME_LENGTH, type Recipe } from "../recipe/types";
import { nameProblem, validateRecipe } from "../recipe/validate";

export type PatternStatus = "saved" | "changed" | "new";

export interface PatternEntry {
  name: string;
  recipe: Recipe;
  savedAs: string | null;
  status: PatternStatus;
  problems: string[];
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
}

const DRAFTS_KEY = "firewalker-designer:drafts:v1";
const API = "/api/patterns";

export class PatternLibrary {
  private repo = new Map<string, Recipe>();
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
    try {
      const response = await fetch(API);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { dir: string; patterns: { name: string; recipe: Recipe | null; errors?: string[] }[] };
      this.repo = new Map(body.patterns.filter((p) => p.recipe).map((p) => [p.name, p.recipe!]));
      this.broken = body.patterns.filter((p) => !p.recipe).map((p) => ({ name: p.name, errors: p.errors ?? [] }));
      this.repoAvailable = true;
      this.repoDir = body.dir;
    } catch {
      this.repoAvailable = false;
    }
    this.loading = false;
    this.emit();
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
    this.drafts[name] = { recipe: { ...recipe, name }, savedAs: null, updatedAt: Date.now() };
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
      this.drafts[name] = { recipe: next, savedAs: entry.savedAs, updatedAt: Date.now() };
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
    delete this.drafts[name];
    this.drafts[newName] = { recipe: { ...entry.recipe, name: newName }, savedAs: entry.savedAs, updatedAt: Date.now() };
    this.commit();
    return null;
  }

  // Drops the draft, back to the saved file. A pattern that was never saved goes away.
  discard(name: string): void {
    delete this.drafts[name];
    this.commit();
  }

  // Writes the pattern to patterns/<name>.json. Returns the problems if it couldn't.
  async save(name: string): Promise<string[]> {
    const entry = this.entry(name);
    if (!entry) return ["That pattern no longer exists."];
    const result = validateRecipe(entry.recipe);
    if (!result.ok) return result.errors;
    if (!this.repoAvailable) return ["Saving to the repo needs the designer's dev server (bun run dev)."];

    const replaces = entry.savedAs && entry.savedAs !== name ? `?replaces=${encodeURIComponent(entry.savedAs)}` : "";
    const response = await fetch(`${API}/${encodeURIComponent(name)}${replaces}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: recipeToJson(entry.recipe),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; errors?: string[] };
    if (!response.ok) return body.errors?.length ? body.errors : [body.error ?? `Save failed (HTTP ${response.status}).`];

    if (entry.savedAs && entry.savedAs !== name) this.repo.delete(entry.savedAs);
    this.repo.set(name, entry.recipe);
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
    }
    delete this.drafts[name];
    this.commit();
    return null;
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
      if (draft.savedAs && this.repo.has(draft.savedAs)) draftFor.set(draft.savedAs, [name, draft]);
    }

    for (const [file, recipe] of this.repo) {
      const draft = draftFor.get(file);
      entries.push(
        draft
          ? makeEntry(draft[0], draft[1].recipe, file, "changed")
          : makeEntry(file, recipe, file, "saved"),
      );
    }
    for (const [name, draft] of Object.entries(this.drafts)) {
      if (draft.savedAs && this.repo.has(draft.savedAs)) continue;
      // While the repo is still loading, or unreachable, a draft of a saved file shows as changed.
      const status: PatternStatus = draft.savedAs && (this.loading || !this.repoAvailable) ? "changed" : "new";
      entries.push(makeEntry(name, draft.recipe, status === "new" ? null : draft.savedAs, status));
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

function makeEntry(name: string, recipe: Recipe, savedAs: string | null, status: PatternStatus): PatternEntry {
  const result = validateRecipe(recipe);
  return { name, recipe, savedAs, status, problems: result.ok ? [] : result.errors };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
