import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { deletePattern, listPatterns, PatternStoreError, savePattern } from "./patternStore";
import { newLayer } from "../src/recipe/spec";
import type { Recipe } from "../src/recipe/types";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "patterns-"));
});

function recipe(name: string): Recipe {
  return { format: "firewalker-recipe", version: 1, name, description: "", layers: [newLayer("fill")] };
}

describe("pattern store", () => {
  it("saves, lists, and deletes a recipe", async () => {
    await savePattern(dir, "glow", recipe("glow"));
    expect(await readdir(dir)).toEqual(["glow.json"]);
    expect(await listPatterns(dir)).toMatchObject([{ name: "glow", recipe: recipe("glow") }]);
    await deletePattern(dir, "glow");
    expect(await listPatterns(dir)).toEqual([]);
  });

  it("writes stable, ordered JSON", async () => {
    await savePattern(dir, "glow", recipe("glow"));
    const text = await readFile(path.join(dir, "glow.json"), "utf8");
    expect(text.startsWith('{\n  "format": "firewalker-recipe",\n  "version": 1,\n  "name": "glow"')).toBe(true);
  });

  it("renames by writing the new file and removing the old one", async () => {
    await savePattern(dir, "glow", recipe("glow"));
    await savePattern(dir, "ember", recipe("ember"), "glow");
    expect(await readdir(dir)).toEqual(["ember.json"]);
  });

  it("gives a file a version that changes with its contents", async () => {
    const saved = await savePattern(dir, "glow", recipe("glow"));
    const [listed] = await listPatterns(dir);
    expect(listed?.version).toBe(saved.version);
    await savePattern(dir, "glow", { ...recipe("glow"), description: "warmer" });
    const [changed] = await listPatterns(dir);
    expect(changed?.version).not.toBe(saved.version);
  });

  describe("when told what to expect on disk", () => {
    const warmer = { ...recipe("glow"), description: "warmer" };

    it("saves over a file that still has the expected version", async () => {
      const { version } = await savePattern(dir, "glow", recipe("glow"));
      await savePattern(dir, "glow", warmer, undefined, version);
      expect((await listPatterns(dir))[0]?.recipe?.description).toBe("warmer");
    });

    it("refuses a file that changed, and leaves it alone", async () => {
      const { version } = await savePattern(dir, "glow", recipe("glow"));
      await writeFile(path.join(dir, "glow.json"), JSON.stringify({ ...recipe("glow"), description: "pulled" }));
      await expect(savePattern(dir, "glow", warmer, undefined, version)).rejects.toMatchObject({ status: 409 });
      expect((await listPatterns(dir))[0]?.recipe?.description).toBe("pulled");
    });

    it("refuses a file that was deleted", async () => {
      const { version } = await savePattern(dir, "glow", recipe("glow"));
      await deletePattern(dir, "glow");
      await expect(savePattern(dir, "glow", warmer, undefined, version)).rejects.toMatchObject({ status: 409 });
      expect(await readdir(dir)).toEqual([]);
    });

    it("refuses a new pattern whose name now has a file", async () => {
      await savePattern(dir, "glow", recipe("glow"));
      await expect(savePattern(dir, "glow", warmer, undefined, null)).rejects.toMatchObject({ status: 409 });
    });

    it("saves a new pattern when its name is still free", async () => {
      await savePattern(dir, "glow", recipe("glow"), undefined, null);
      expect(await readdir(dir)).toEqual(["glow.json"]);
    });

    it("refuses a rename onto a file that has appeared, keeping both files", async () => {
      const { version } = await savePattern(dir, "glow", recipe("glow"));
      await savePattern(dir, "ember", recipe("ember"));
      await expect(savePattern(dir, "ember", recipe("ember"), "glow", version)).rejects.toMatchObject({ status: 409 });
      expect(await readdir(dir)).toEqual(["ember.json", "glow.json"]);
    });

    it("lets only one of two saves from the same version through", async () => {
      const { version } = await savePattern(dir, "glow", recipe("glow"));
      const results = await Promise.allSettled([
        savePattern(dir, "glow", warmer, undefined, version),
        savePattern(dir, "glow", { ...recipe("glow"), description: "cooler" }, undefined, version),
      ]);
      expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
      expect(results[1]).toMatchObject({ reason: { status: 409 } });
      expect((await listPatterns(dir))[0]?.recipe?.description).toBe("warmer");
      expect(await readdir(dir)).toEqual(["glow.json"]);
    });

    it("renames when the old file is as expected", async () => {
      const { version } = await savePattern(dir, "glow", recipe("glow"));
      await savePattern(dir, "ember", recipe("ember"), "glow", version);
      expect(await readdir(dir)).toEqual(["ember.json"]);
    });
  });

  it("refuses names that could escape the folder", async () => {
    await expect(savePattern(dir, "../evil", recipe("evil"))).rejects.toBeInstanceOf(PatternStoreError);
    await expect(deletePattern(dir, "../../etc/passwd")).rejects.toBeInstanceOf(PatternStoreError);
    await expect(savePattern(dir, "ok", recipe("ok"), "../x")).rejects.toBeInstanceOf(PatternStoreError);
  });

  it("refuses invalid recipes and mismatched names", async () => {
    await expect(savePattern(dir, "glow", { ...recipe("glow"), layers: [] })).rejects.toMatchObject({ status: 422 });
    await expect(savePattern(dir, "glow", recipe("ember"))).rejects.toMatchObject({ status: 422 });
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses a recipe that can't run on a boot", async () => {
    const palette = Array.from({ length: 16 }, () => "#102030");
    const tooBig = { ...recipe("glow"), layers: Array.from({ length: 8 }, () => ({ ...newLayer("fill"), palette })) };
    await expect(savePattern(dir, "glow", tooBig)).rejects.toMatchObject({ status: 422, errors: [expect.stringMatching(/over a boot's limit/)] });
    await expect(savePattern(dir, "glow", { ...recipe("glow"), layers: [{ ...newLayer("fill"), enabled: false }] })).rejects.toMatchObject({ status: 422 });
    expect(await readdir(dir)).toEqual([]);
  });

  it("reports broken files instead of failing the whole list", async () => {
    await writeFile(path.join(dir, "broken.json"), "{ nope");
    await savePattern(dir, "glow", recipe("glow"));
    const list = await listPatterns(dir);
    expect(list.map((p) => [p.name, p.recipe === null])).toEqual([
      ["broken", true],
      ["glow", false],
    ]);
  });

  it("returns an empty list when the folder doesn't exist yet", async () => {
    expect(await listPatterns(path.join(dir, "missing"))).toEqual([]);
  });
});
