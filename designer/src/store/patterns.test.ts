import { beforeEach, describe, expect, it, vi } from "vitest";

import { PatternLibrary } from "./patterns";
import { newLayer } from "../recipe/spec";
import type { Recipe } from "../recipe/types";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

function recipe(name: string, description = ""): Recipe {
  return { format: "firewalker-recipe", version: 1, name, description, layers: [newLayer("fill")] };
}

// A file's version in the fake server: its contents, which change whenever the file does.
const versionOf = (file: Recipe | undefined) => (file ? JSON.stringify(file) : undefined);

// A stand-in for the dev server's patterns API over a map of files.
function fakeServer(files: Map<string, Recipe>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, "http://localhost");
    const name = decodeURIComponent(u.pathname.replace("/api/patterns", "").replace(/^\//, ""));
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (!init?.method || init.method === "GET") {
      return json(200, { dir: "/repo/patterns", patterns: [...files].map(([n, r]) => ({ name: n, recipe: r, version: versionOf(r) })) });
    }
    if (init.method === "PUT") {
      const replaces = u.searchParams.get("replaces");
      const expected = u.searchParams.get("expected");
      if (expected !== null) {
        const source = versionOf(files.get(replaces ?? name));
        if (expected === "none" ? files.has(name) : source !== expected || (replaces && files.has(name))) {
          return json(409, { ok: false, error: "The file changed." });
        }
      }
      const saved = JSON.parse(init.body as string) as Recipe;
      files.set(name, saved);
      if (replaces) files.delete(replaces);
      return json(200, { ok: true, version: versionOf(saved) });
    }
    files.delete(name);
    return json(200, { ok: true });
  });
}

let files: Map<string, Recipe>;
let storage: MemoryStorage;

beforeEach(() => {
  files = new Map([["glow", recipe("glow")]]);
  storage = new MemoryStorage();
  vi.stubGlobal("fetch", fakeServer(files));
});

async function library(): Promise<PatternLibrary> {
  const lib = new PatternLibrary(storage as unknown as Storage);
  await lib.load();
  return lib;
}

describe("PatternLibrary", () => {
  it("restores browser-saved recipes even when the included catalog cannot load", async () => {
    const options = { browserStorage: true, catalogUrl: "/patterns.json" };
    const lib = new PatternLibrary(storage as unknown as Storage, options);
    await lib.load();
    await lib.save(lib.create(recipe("pocket")));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const restored = new PatternLibrary(storage as unknown as Storage, options);
    await restored.load();
    expect(restored.entry("pocket")).toMatchObject({ status: "saved" });
  });

  it("saves hosted edits in this browser and restores them without writing to the repo", async () => {
    const fetch = fakeServer(files);
    vi.stubGlobal("fetch", fetch);
    const lib = new PatternLibrary(storage as unknown as Storage, { browserStorage: true, catalogUrl: "/patterns.json" });
    await lib.load();
    const name = lib.create(recipe("pocket", "Saved on this computer"));
    expect(await lib.save(name)).toEqual([]);

    const restored = new PatternLibrary(storage as unknown as Storage, { browserStorage: true, catalogUrl: "/patterns.json" });
    await restored.load();
    expect(restored.entry("pocket")).toMatchObject({ status: "saved", recipe: { description: "Saved on this computer" } });
    expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });

  it("opens a draft made before a field existed, with that field's default", async () => {
    const old = { ...recipe("comets"), layers: [{ ...newLayer("chase"), path: undefined }] };
    storage.setItem("firewalker-designer:drafts:v1", JSON.stringify({ comets: { recipe: old, savedAs: null, updatedAt: 0 } }));
    const entry = (await library()).entry("comets")!;
    expect(entry.recipe.layers[0]).toMatchObject({ type: "chase", path: "ring" });
    expect(entry.problems).toEqual([]);
  });

  it("reports what a pattern takes on a boot, and won't save one over the limit", async () => {
    const lib = await library();
    expect(lib.entry("glow")?.compiledSize).toBeGreaterThan(0);

    const palette = Array.from({ length: 16 }, () => "#102030");
    const tooBig = { ...recipe("glow"), layers: Array.from({ length: 8 }, () => ({ ...newLayer("fill"), palette })) } as Recipe;
    lib.update("glow", tooBig);
    const entry = lib.entry("glow")!;
    expect(entry.compiledSize).toBeGreaterThan(254);
    expect(entry.problems[0]).toMatch(/over a boot's limit/);
    expect(await lib.save("glow")).toEqual(entry.problems);
    expect(files.get("glow")?.layers).toHaveLength(1);
  });

  it("lists saved files", async () => {
    const lib = await library();
    expect(lib.getSnapshot().entries.map((e) => [e.name, e.status])).toEqual([["glow", "saved"]]);
  });

  it("keeps edits as a draft until Save writes the file", async () => {
    const lib = await library();
    lib.update("glow", recipe("glow", "warmer"));
    expect(lib.entry("glow")?.status).toBe("changed");
    expect(files.get("glow")?.description).toBe("");

    expect(await lib.save("glow")).toEqual([]);
    expect(files.get("glow")?.description).toBe("warmer");
    expect(lib.entry("glow")?.status).toBe("saved");
  });

  it("keeps drafts across a reload", async () => {
    (await library()).update("glow", recipe("glow", "warmer"));
    const reloaded = await library();
    expect(reloaded.entry("glow")?.recipe.description).toBe("warmer");
  });

  it("drops the draft when an edit returns to the saved version", async () => {
    const lib = await library();
    lib.update("glow", recipe("glow", "warmer"));
    lib.update("glow", recipe("glow"));
    expect(lib.entry("glow")?.status).toBe("saved");
  });

  it("saves a rename as a move", async () => {
    const lib = await library();
    expect(lib.rename("glow", "ember")).toBeNull();
    expect(lib.entry("ember")?.status).toBe("changed");
    await lib.save("ember");
    expect([...files.keys()]).toEqual(["ember"]);
  });

  it("refuses a rename onto a taken or invalid name", async () => {
    const lib = await library();
    lib.create(recipe("ember"));
    expect(lib.rename("glow", "ember")).toMatch(/already exists/);
    expect(lib.rename("glow", "Bad Name")).toMatch(/must start/);
  });

  it("creates new patterns with unique names", async () => {
    const lib = await library();
    expect(lib.create(recipe("glow"))).toBe("glow-2");
    expect(lib.duplicate("glow")).toBe("glow-3");
    expect(lib.entry("glow-2")?.status).toBe("new");
    expect(lib.uniqueName("abcdefghijkl")).toBe("abcdefghijkl");
  });

  it("discards a new pattern entirely, and a change back to the file", async () => {
    const lib = await library();
    const name = lib.create(recipe("spark"));
    lib.discard(name);
    expect(lib.entry(name)).toBeUndefined();
    lib.update("glow", recipe("glow", "warmer"));
    lib.discard("glow");
    expect(lib.entry("glow")?.recipe.description).toBe("");
  });

  it("deletes the file and the draft", async () => {
    const lib = await library();
    lib.update("glow", recipe("glow", "warmer"));
    expect(await lib.remove("glow")).toBeNull();
    expect(files.size).toBe(0);
    expect(lib.getSnapshot().entries).toEqual([]);
  });

  describe("when a file changes outside the designer", () => {
    it("reports nothing while the file stays as the draft found it", async () => {
      const lib = await library();
      lib.update("glow", recipe("glow", "warmer"));
      await lib.refresh();
      expect(lib.entry("glow")?.conflict).toBeNull();
    });

    it("shows the change on refresh, with no draft involved", async () => {
      const lib = await library();
      files.set("glow", recipe("glow", "pulled"));
      await lib.refresh();
      expect(lib.entry("glow")).toMatchObject({ status: "saved", conflict: null, recipe: { description: "pulled" } });
    });

    it("flags the draft on refresh", async () => {
      const lib = await library();
      lib.update("glow", recipe("glow", "warmer"));
      files.set("glow", recipe("glow", "pulled"));
      await lib.refresh();
      expect(lib.entry("glow")).toMatchObject({ status: "changed", conflict: "changed", recipe: { description: "warmer" } });
    });

    it("won't save over it, even without a refresh, and reports why", async () => {
      const lib = await library();
      lib.update("glow", recipe("glow", "warmer"));
      files.set("glow", recipe("glow", "pulled"));
      expect(await lib.save("glow")).toEqual(["The file changed."]);
      expect(files.get("glow")?.description).toBe("pulled");
      expect(lib.entry("glow")?.conflict).toBe("changed");
    });

    it("overwrites when told to", async () => {
      const lib = await library();
      lib.update("glow", recipe("glow", "warmer"));
      files.set("glow", recipe("glow", "pulled"));
      expect(await lib.save("glow", { overwrite: true })).toEqual([]);
      expect(files.get("glow")?.description).toBe("warmer");
      expect(lib.entry("glow")).toMatchObject({ status: "saved", conflict: null });
    });

    it("can drop the draft and use the file", async () => {
      const lib = await library();
      lib.update("glow", recipe("glow", "warmer"));
      files.set("glow", recipe("glow", "pulled"));
      await lib.refresh();
      lib.discard("glow");
      expect(lib.entry("glow")).toMatchObject({ status: "saved", conflict: null, recipe: { description: "pulled" } });
    });

    it("keeps the draft's starting point across more edits", async () => {
      const lib = await library();
      lib.update("glow", recipe("glow", "warmer"));
      files.set("glow", recipe("glow", "pulled"));
      lib.update("glow", recipe("glow", "warmer still"));
      expect(await lib.save("glow")).toEqual(["The file changed."]);
    });

    it("starts a new draft from the file as it is now", async () => {
      const lib = await library();
      files.set("glow", recipe("glow", "pulled"));
      await lib.refresh();
      lib.update("glow", recipe("glow", "warmer"));
      expect(await lib.save("glow")).toEqual([]);
      expect(files.get("glow")?.description).toBe("warmer");
    });

    it("saves again after a save, with no false alarm", async () => {
      const lib = await library();
      lib.update("glow", recipe("glow", "warmer"));
      await lib.save("glow");
      lib.update("glow", recipe("glow", "warmer still"));
      expect(await lib.save("glow")).toEqual([]);
      expect(files.get("glow")?.description).toBe("warmer still");
    });

    it("drops a draft the pull has caught up with", async () => {
      const lib = await library();
      lib.update("glow", recipe("glow", "warmer"));
      files.set("glow", recipe("glow", "warmer"));
      await lib.refresh();
      expect(lib.entry("glow")).toMatchObject({ status: "saved", conflict: null });
    });

    it("flags a draft whose file was deleted, and can bring it back", async () => {
      const lib = await library();
      lib.update("glow", recipe("glow", "warmer"));
      files.delete("glow");
      await lib.refresh();
      expect(lib.entry("glow")?.conflict).toBe("deleted");
      expect(await lib.save("glow", { overwrite: true })).toEqual([]);
      expect(files.get("glow")?.description).toBe("warmer");
    });

    it("merges a new draft with a same-named file that has appeared", async () => {
      const lib = await library();
      lib.create(recipe("spark", "mine"));
      files.set("spark", recipe("spark", "pulled"));
      await lib.refresh();
      const entries = lib.getSnapshot().entries.filter((e) => e.name === "spark");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ conflict: "changed", recipe: { description: "mine" } });
      expect(await lib.save("spark")).toEqual(["The file changed."]);
    });

    it("flags a rename onto a file that has appeared, listing the name once", async () => {
      const lib = await library();
      lib.rename("glow", "ember");
      files.set("ember", recipe("ember", "pulled"));
      await lib.refresh();
      const entries = lib.getSnapshot().entries.filter((e) => e.name === "ember");
      expect(entries).toHaveLength(1);
      expect(entries[0]?.conflict).toBe("changed");
      expect(await lib.save("ember")).toEqual(["The file changed."]);
      expect(files.get("ember")?.description).toBe("pulled");
    });

    it("saves a draft from before versions existed without checking", async () => {
      storage.setItem("firewalker-designer:drafts:v1", JSON.stringify({ glow: { recipe: recipe("glow", "old"), savedAs: "glow", updatedAt: 0 } }));
      const lib = await library();
      expect(lib.entry("glow")?.conflict).toBeNull();
      expect(await lib.save("glow")).toEqual([]);
      expect(files.get("glow")?.description).toBe("old");
    });

    it("tells listeners only when a refresh found something", async () => {
      const lib = await library();
      const listener = vi.fn();
      lib.subscribe(listener);
      await lib.refresh();
      expect(listener).not.toHaveBeenCalled();
      files.set("glow", recipe("glow", "pulled"));
      await lib.refresh();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  it("works from drafts alone when the dev server isn't there", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const lib = await library();
    lib.create(recipe("spark"));
    expect(lib.getSnapshot().repoAvailable).toBe(false);
    expect(await lib.save("spark")).toEqual(["Saving to the repo needs the designer's dev server (bun run dev)."]);
  });
});
