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

// A stand-in for the dev server's patterns API over a map of files.
function fakeServer(files: Map<string, Recipe>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, "http://localhost");
    const name = decodeURIComponent(u.pathname.replace("/api/patterns", "").replace(/^\//, ""));
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (!init?.method || init.method === "GET") {
      return json(200, { dir: "/repo/patterns", patterns: [...files].map(([n, r]) => ({ name: n, recipe: r })) });
    }
    if (init.method === "PUT") {
      files.set(name, JSON.parse(init.body as string));
      const replaces = u.searchParams.get("replaces");
      if (replaces) files.delete(replaces);
      return json(200, { ok: true });
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
  it("opens a draft made before a field existed, with that field's default", async () => {
    const old = { ...recipe("comets"), layers: [{ ...newLayer("chase"), path: undefined }] };
    storage.setItem("firewalker-designer:drafts:v1", JSON.stringify({ comets: { recipe: old, savedAs: null, updatedAt: 0 } }));
    const entry = (await library()).entry("comets")!;
    expect(entry.recipe.layers[0]).toMatchObject({ type: "chase", path: "ring" });
    expect(entry.problems).toEqual([]);
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

  it("works from drafts alone when the dev server isn't there", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const lib = await library();
    lib.create(recipe("spark"));
    expect(lib.getSnapshot().repoAvailable).toBe(false);
    expect(await lib.save("spark")).toEqual(["Saving to the repo needs the designer's dev server (bun run dev)."]);
  });
});
