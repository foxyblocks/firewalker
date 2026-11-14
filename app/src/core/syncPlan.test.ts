import { describe, expect, it } from "vitest";
import type { WantedRecipe } from "./patternLibrary";
import { planSync, recordAfterSync, type BootRecipes, type OnBootRecord } from "./syncPlan";

const recipe = (name: string, crc = "aaaaaaaa", recipeVersion = 1, size = 40): WantedRecipe => ({
  name, crc, recipeVersion, origin: "canonical", bytes: new Uint8Array(size),
});

const boot = (uploads: BootRecipes["uploads"] = {}, { free = 16 - Object.keys(uploads).length, versions = [1, 2] } = {}): BootRecipes => ({
  versions, free, uploads,
});

const names = (recipes: readonly WantedRecipe[]) => recipes.map((wanted) => wanted.name);

describe("planSync", () => {
  it("uploads every wanted recipe to a boot that has none", () => {
    const plan = planSync([recipe("comet"), recipe("lava-pour")], boot(), {});
    expect(names(plan.uploads)).toEqual(["comet", "lava-pour"]);
    expect(plan.deletes).toEqual([]);
  });

  it("skips a recipe the boot already has with the same bytes", () => {
    const plan = planSync([recipe("comet")], boot({ comet: { bytes: 40, crc: "aaaaaaaa" } }), { comet: "canonical" });
    expect(plan.uploads).toEqual([]);
    expect(names(plan.upToDate)).toEqual(["comet"]);
  });

  // Main is canonical: a designer experiment that reuses a main pattern's name goes back to main's.
  it("replaces an upload whose checksum or size differs, whoever put it there", () => {
    const plan = planSync(
      [recipe("comet"), recipe("starfield")],
      boot({ comet: { bytes: 40, crc: "bbbbbbbb" }, starfield: { bytes: 41, crc: "aaaaaaaa" } }),
      {},
    );
    expect(names(plan.uploads)).toEqual(["comet", "starfield"]);
  });

  it("uploads over an upload it couldn't read", () => {
    const plan = planSync([recipe("comet")], boot({ comet: null }), {});
    expect(names(plan.uploads)).toEqual(["comet"]);
  });

  it("holds back a recipe the boot's firmware can't read", () => {
    const plan = planSync([recipe("comet"), recipe("bass-ripple", "cccccccc", 2)], boot({}, { versions: [1] }), {});
    expect(names(plan.uploads)).toEqual(["comet"]);
    expect(names(plan.needsFirmware)).toEqual(["bass-ripple"]);
  });

  it("deletes an upload this phone put there that main no longer has", () => {
    const plan = planSync([recipe("comet")], boot({ comet: { bytes: 40, crc: "aaaaaaaa" }, old: { bytes: 30, crc: "dddddddd" } }), {
      comet: "canonical",
      old: "canonical",
    });
    expect(plan.deletes).toEqual(["old"]);
  });

  it("leaves alone an upload this phone never put there, such as a designer experiment", () => {
    const plan = planSync([recipe("comet")], boot({ "my-test": { bytes: 30, crc: "dddddddd" } }), {});
    expect(plan.deletes).toEqual([]);
  });

  it("has nothing to delete when an upload it put there is already gone", () => {
    const plan = planSync([recipe("comet")], boot(), { gone: "canonical" });
    expect(plan.deletes).toEqual([]);
  });

  describe("when slots run out", () => {
    it("uploads what fits and reports the rest", () => {
      const plan = planSync([recipe("a"), recipe("b"), recipe("c")], boot({}, { free: 2 }), {});
      expect(names(plan.uploads)).toEqual(["a", "b"]);
      expect(names(plan.noRoom)).toEqual(["c"]);
    });

    it("counts the slots its deletes free up", () => {
      const plan = planSync([recipe("a"), recipe("b")], boot({ old: { bytes: 30, crc: "dddddddd" } }, { free: 1 }), { old: "canonical" });
      expect(plan.deletes).toEqual(["old"]);
      expect(names(plan.uploads)).toEqual(["a", "b"]);
      expect(plan.noRoom).toEqual([]);
    });

    it("replaces an existing upload even with no free slot", () => {
      const plan = planSync([recipe("comet"), recipe("new")], boot({ comet: { bytes: 40, crc: "bbbbbbbb" } }, { free: 0 }), {});
      expect(names(plan.uploads)).toEqual(["comet"]);
      expect(names(plan.noRoom)).toEqual(["new"]);
    });
  });
});

describe("recordAfterSync", () => {
  const before = boot({ comet: { bytes: 40, crc: "bbbbbbbb" }, old: { bytes: 30, crc: "dddddddd" }, "my-test": { bytes: 30, crc: "eeeeeeee" } });
  const record: OnBootRecord = { old: "canonical" };
  const plan = planSync([recipe("comet"), recipe("lava-pour")], before, record);

  it("adds what it uploaded and drops what it deleted", () => {
    expect(recordAfterSync(record, plan, before, { deleted: ["old"], uploaded: ["comet", "lava-pour"] })).toEqual({
      comet: "canonical",
      "lava-pour": "canonical",
    });
  });

  it("keeps a name whose delete failed, to try again next time", () => {
    expect(recordAfterSync(record, plan, before, { deleted: [], uploaded: ["comet", "lava-pour"] })).toEqual({
      comet: "canonical",
      "lava-pour": "canonical",
      old: "canonical",
    });
  });

  it("leaves out an upload that failed, unless it put an older copy there before", () => {
    const earlier: OnBootRecord = { comet: "canonical" };
    const again = planSync([recipe("comet"), recipe("lava-pour")], before, earlier);
    expect(recordAfterSync(earlier, again, before, { deleted: [], uploaded: [] })).toEqual({ comet: "canonical" });
  });

  // A boot that already has main's exact bytes, however they got there, holds main's pattern, so
  // removing it from main should remove it from the boot.
  it("counts a recipe that was already up to date as this phone's", () => {
    const current = boot({ comet: { bytes: 40, crc: "aaaaaaaa" } });
    const upToDate = planSync([recipe("comet")], current, {});
    expect(recordAfterSync({}, upToDate, current, { deleted: [], uploaded: [] })).toEqual({ comet: "canonical" });
  });

  it("forgets a name that's no longer on the boot", () => {
    const empty = boot();
    expect(recordAfterSync({ gone: "canonical" }, planSync([], empty, { gone: "canonical" }), empty, { deleted: [], uploaded: [] })).toEqual({});
  });
});
