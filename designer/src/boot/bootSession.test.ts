import { beforeEach, describe, expect, it, vi } from "vitest";

import { BootSession, NEEDS_FIRMWARE, type SendProgress } from "./bootSession";
import { BootConnections } from "./connections";
import { FakeBoot, FakeBootTransport } from "./fakeBoot";
import { compileRecipe } from "../recipe/compile";
import { newLayer } from "../recipe/spec";
import type { Layer, Recipe } from "../recipe/types";

const RECIPE: Recipe = {
  format: "firewalker-recipe",
  version: 1,
  name: "spark",
  description: "",
  layers: [{ ...newLayer("fill"), palette: ["#ff0000", "#00ff00", "#0000ff"] } as Layer, newLayer("sparkle")],
};

function compiled(recipe: Recipe = RECIPE): Uint8Array {
  const result = compileRecipe(recipe);
  if (!result.ok) throw new Error(result.errors.join(" "));
  return result.bytes;
}

// A session wired straight to a fake boot.
function connect(boot: FakeBoot): BootSession {
  const session: BootSession = new BootSession(async (line) => {
    const replies = boot.handle(line);
    queueMicrotask(() => {
      for (const reply of replies) session.receive(`${reply}\n`);
    });
  });
  return session;
}

describe("sending a recipe", () => {
  let boot: FakeBoot;

  beforeEach(() => {
    boot = new FakeBoot();
  });

  it("uploads it, saves it, and selects it", async () => {
    const bytes = compiled();
    expect(await connect(boot).sendRecipe("spark", bytes)).toEqual({ ok: true, alreadyThere: false });
    expect(boot.stored.get("spark")).toEqual(bytes);
    expect(boot.pattern).toBe("spark");
  });

  it("keeps every line under the boot's 48-byte command limit", async () => {
    await connect(boot).sendRecipe("abcdefghijkl", compiled({ ...RECIPE, name: "abcdefghijkl" }));
    expect(boot.linesSeen.length).toBeGreaterThan(5);
    for (const line of boot.linesSeen) expect(line.length).toBeLessThan(48);
  });

  it("reports progress up to the whole recipe", async () => {
    const bytes = compiled();
    const seen: SendProgress[] = [];
    await connect(boot).sendRecipe("spark", bytes, (progress) => seen.push(progress));
    expect(seen[0]).toEqual({ stage: "checking" });
    expect(seen).toContainEqual({ stage: "sending", sent: bytes.length, total: bytes.length });
    expect(seen.at(-1)).toEqual({ stage: "selecting" });
  });

  it("skips the upload when the boot already has these exact bytes, and still selects it", async () => {
    const session = connect(boot);
    await session.sendRecipe("spark", compiled());
    boot.pattern = "flow";
    boot.linesSeen = [];
    expect(await session.sendRecipe("spark", compiled())).toEqual({ ok: true, alreadyThere: true });
    expect(boot.linesSeen.some((line) => line.startsWith("recipe data"))).toBe(false);
    expect(boot.pattern).toBe("spark");
  });

  it("uploads again when the recipe changed", async () => {
    const session = connect(boot);
    await session.sendRecipe("spark", compiled());
    const changed = compiled({ ...RECIPE, layers: [newLayer("pool")] });
    expect(await session.sendRecipe("spark", changed)).toEqual({ ok: true, alreadyThere: false });
    expect(boot.stored.get("spark")).toEqual(changed);
  });

  it("carries on from the right place after a lost line", async () => {
    boot.loseNextData = true;
    const bytes = compiled();
    expect(await connect(boot).sendRecipe("spark", bytes)).toMatchObject({ ok: true });
    expect(boot.stored.get("spark")).toEqual(bytes);
  });

  it("tells you when a boot's firmware is too old", async () => {
    const old = new FakeBoot({ proto: 2 });
    expect(await connect(old).sendRecipe("spark", compiled())).toEqual({ ok: false, error: NEEDS_FIRMWARE });
    expect(old.linesSeen).toEqual(["status"]);
  });

  it("tells you when a boot can't read this version of the format", async () => {
    const other = new FakeBoot({ versions: [99] });
    expect(await connect(other).sendRecipe("spark", compiled())).toEqual({ ok: false, error: NEEDS_FIRMWARE });
  });

  it("says when the boot is full, and sends nothing", async () => {
    const full = new FakeBoot({ slots: 0 });
    const result = await connect(full).sendRecipe("spark", compiled());
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/slots are full/) });
    expect(full.linesSeen.some((line) => line.startsWith("recipe data"))).toBe(false);
    expect(full.pattern).toBe("flow");
  });

  it("gives up cleanly on a boot that stops answering", async () => {
    vi.useFakeTimers();
    try {
      const silent = new FakeBoot({ silent: true });
      const sending = connect(silent).sendRecipe("spark", compiled());
      await vi.advanceTimersByTimeAsync(4000);
      expect(await sending).toEqual({ ok: false, error: "The boot stopped answering." });
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips lines nobody asked for", async () => {
    const session = connect(boot);
    session.receive("[firewalker] a log line\n");
    const asked = session.status();
    session.receive('{"t":"motion","tilt":0.1}\n[firewalker] another\n');
    expect(await asked).toMatchObject({ t: "status", id: "FA4E" });
  });

  it("puts a reply back together from pieces", async () => {
    const session = new BootSession(async () => undefined);
    const asked = session.status();
    session.receive('{"t":"sta');
    session.receive('tus","proto":3}\n');
    expect(await asked).toMatchObject({ proto: 3 });
  });
});

describe("connections", () => {
  it("connects to a boot, sends to it, and lists what's on it", async () => {
    const connections = new BootConnections(async () => new FakeBootTransport([new FakeBoot({ id: "3EB5" })]));
    await connections.prepare();
    expect(connections.getSnapshot().pickers).toContain("usb");

    await connections.connect("usb");
    const [boot] = connections.getSnapshot().boots;
    expect(boot).toMatchObject({ name: "Firewalker-3EB5", uploads: [], slots: 16 });

    await connections.send(boot!.deviceId, RECIPE);
    expect(connections.getSnapshot().boots[0]).toMatchObject({ sending: false, failed: false, uploads: ["spark"] });
    expect(connections.getSnapshot().boots[0]?.activity).toMatch(/on the strip/);

    await connections.deleteUpload(boot!.deviceId, "spark");
    expect(connections.getSnapshot().boots[0]?.uploads).toEqual([]);
  });

  it("keeps two boots apart", async () => {
    const transport = new FakeBootTransport();
    const connections = new BootConnections(async () => transport);
    await connections.prepare();
    await connections.connect("usb");
    await connections.connect("usb");
    const boots = connections.getSnapshot().boots;
    expect(boots.map((boot) => boot.name)).toEqual(["Firewalker-3EB5", "Firewalker-3ED8"]);

    await connections.send(boots[1]!.deviceId, RECIPE);
    expect(transport.boots[0]!.stored.size).toBe(0);
    expect(transport.boots[1]!.stored.size).toBe(1);
  });

  it("says why a recipe can't be sent, without bothering the boot", async () => {
    const transport = new FakeBootTransport([new FakeBoot()]);
    const connections = new BootConnections(async () => transport);
    await connections.prepare();
    await connections.connect("usb");
    const [boot] = connections.getSnapshot().boots;
    transport.boots[0]!.linesSeen = [];
    await connections.send(boot!.deviceId, { ...RECIPE, layers: [{ ...newLayer("fill"), enabled: false }] });
    expect(connections.getSnapshot().boots[0]).toMatchObject({ failed: true, activity: expect.stringMatching(/at least one layer/) });
    expect(transport.boots[0]!.linesSeen).toEqual([]);
  });

  it("forgets a boot when its link drops", async () => {
    const connections = new BootConnections(async () => new FakeBootTransport([new FakeBoot()]));
    await connections.prepare();
    await connections.connect("usb");
    const [boot] = connections.getSnapshot().boots;
    await connections.disconnect(boot!.deviceId);
    expect(connections.getSnapshot().boots).toEqual([]);
  });

  it("says when boots can't be reached from this browser", async () => {
    const connections = new BootConnections(async () => {
      throw new Error("no Bluetooth");
    });
    await connections.prepare();
    expect(connections.getSnapshot().error).toMatch(/no Bluetooth/);
  });
});
