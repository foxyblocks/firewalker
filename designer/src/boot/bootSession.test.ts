import { beforeEach, describe, expect, it, vi } from "vitest";

import { BootSession, BYTES_PER_USB_LINE, NEEDS_FIRMWARE, type SendProgress } from "./bootSession";
import { BootConnections } from "./connections";
import { FakeBoot, FakeBootPorts, FakeBootTransport } from "./fakeBoot";
import { describeHolder, type BootPortsClient } from "./portHolders";
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
// A session that doesn't wait long for a reply, for tests where one never comes.
function connectQuick(boot: FakeBoot, bytesPerLine?: number): BootSession {
  const session: BootSession = new BootSession(
    async (line) => {
      const replies = boot.handle(line);
      queueMicrotask(() => {
        for (const reply of replies) session.receive(`${reply}\n`);
      });
    },
    bytesPerLine,
    5,
  );
  return session;
}

function connect(boot: FakeBoot, bytesPerLine?: number): BootSession {
  const session: BootSession = new BootSession(async (line) => {
    const replies = boot.handle(line);
    queueMicrotask(() => {
      for (const reply of replies) session.receive(`${reply}\n`);
    });
  }, bytesPerLine);
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

  it("keeps every line over USB inside the board's 32-byte buffer, even at the longest", async () => {
    const usb = new FakeBoot({ receiveBytes: 31 });
    const name = "abcdefghijkl";
    const palette = Array.from({ length: 6 }, () => "#102030");
    const big: Recipe = { ...RECIPE, name, layers: Array.from({ length: 6 }, () => ({ ...newLayer("fill"), palette }) as Layer) };
    const bytes = compiled(big);
    expect(bytes.length).toBeGreaterThan(100);
    expect(await connect(usb, BYTES_PER_USB_LINE).sendRecipe(name, bytes)).toMatchObject({ ok: true });
    expect(usb.stored.get(name)).toEqual(bytes);
    for (const line of usb.linesSeen) expect(line.length).toBeLessThanOrEqual(31);
    expect(`recipe data 240 ${"ab".repeat(BYTES_PER_USB_LINE)}`.length).toBeLessThanOrEqual(31);
  });

  it("gives up clearly when a line can never arrive whole", async () => {
    const usb = new FakeBoot({ receiveBytes: 43 });
    const session = connectQuick(usb);
    // A full 15-byte line loses its last character every time here, so resending can't help.
    const result = await session.sendRecipe("spark", compiled());
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/bad-hex/) });
    expect(usb.stored.has("spark")).toBe(false);
  });

  describe("when USB damages a line", () => {
    const isData = (line: string) => line.startsWith("recipe data");

    it("sends again a line that lost a character", async () => {
      let done = false;
      const usb = new FakeBoot({
        damage: (line) => {
          if (done || !isData(line)) return line;
          done = true;
          return line.slice(0, -1);
        },
      });
      const bytes = compiled();
      expect(await connectQuick(usb, BYTES_PER_USB_LINE).sendRecipe("spark", bytes)).toMatchObject({ ok: true });
      expect(usb.stored.get("spark")).toEqual(bytes);
    });

    it("recovers when a line loses its newline and gets no reply", async () => {
      let done = false;
      const usb = new FakeBoot({
        damage: (line) => {
          if (done || !isData(line)) return line;
          done = true;
          return null;
        },
      });
      const bytes = compiled();
      expect(await connectQuick(usb, BYTES_PER_USB_LINE).sendRecipe("spark", bytes)).toMatchObject({ ok: true });
      expect(usb.stored.get("spark")).toEqual(bytes);
    });

    it("starts over when the size in `begin` arrives wrong", async () => {
      let done = false;
      const usb = new FakeBoot({
        damage: (line) => {
          if (done || !line.startsWith("recipe begin")) return line;
          done = true;
          return line.slice(0, -1);
        },
      });
      const bytes = compiled();
      expect(await connectQuick(usb, BYTES_PER_USB_LINE).sendRecipe("spark", bytes)).toMatchObject({ ok: true });
      expect(usb.stored.get("spark")).toEqual(bytes);
    });

    it("gets every upload through when lines are damaged at random, and never stores a bad one", async () => {
      // A small repeatable generator, so a failure here can be reproduced.
      let seed = 12345;
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const usb = new FakeBoot({
        damage: (line) => {
          const roll = random();
          if (roll < 0.03) return line.slice(0, -1);
          if (roll < 0.05) return null;
          return line;
        },
      });
      const session = connectQuick(usb, BYTES_PER_USB_LINE);
      const bytes = compiled();
      for (let i = 0; i < 40; i++) {
        usb.stored.clear();
        expect(await session.sendRecipe("spark", bytes)).toMatchObject({ ok: true });
        expect(usb.stored.get("spark")).toEqual(bytes);
      }
    });

    it("gives up on a boot that never answers a line, and says so", async () => {
      const usb = new FakeBoot({ damage: (line) => (isData(line) ? null : line) });
      const result = await connectQuick(usb, BYTES_PER_USB_LINE).sendRecipe("spark", compiled());
      expect(result.ok).toBe(false);
      expect(usb.stored.has("spark")).toBe(false);
    });
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
    boot.pattern = "rainbow-pool";
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

  it("uploads old recipes to version 1 boots and asks for an update for audio recipes", async () => {
    const old = new FakeBoot({ versions: [1] });
    expect(await connect(old).sendRecipe("spark", compiled())).toMatchObject({ ok: true });

    const audio: Recipe = { ...RECIPE, name: "sound", version: 2, layers: [newLayer("band")] };
    const oldAudio = new FakeBoot({ versions: [1] });
    expect(await connect(oldAudio).sendRecipe("sound", compiled(audio))).toEqual({ ok: false, error: NEEDS_FIRMWARE });
    expect(oldAudio.linesSeen.some((line) => line.startsWith("recipe begin"))).toBe(false);

    const current = new FakeBoot({ versions: [1, 2] });
    expect(await connect(current).sendRecipe("sound", compiled(audio))).toMatchObject({ ok: true });
  });

  it("says when the boot is full, and sends nothing", async () => {
    const full = new FakeBoot({ slots: 0 });
    const result = await connect(full).sendRecipe("spark", compiled());
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/slots are full/) });
    expect(full.linesSeen.some((line) => line.startsWith("recipe data"))).toBe(false);
    expect(full.pattern).toBe("rainbow-pool");
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
    await Promise.resolve();
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

  describe("when something's holding a boot", () => {
    async function connected(busy: string | null) {
      const ports = new FakeBootPorts(busy);
      const connections = new BootConnections(async () => new FakeBootTransport([new FakeBoot()], ports), ports);
      await connections.prepare();
      return { ports, connections };
    }

    it("names one of our tools as soon as the panel opens", async () => {
      const { connections } = await connected("tool");
      expect(connections.getSnapshot().holders).toMatchObject([{ name: "./cli", canFree: true }]);
    });

    it("doesn't mention a browser until connecting fails, since it's often this very tab", async () => {
      const { connections } = await connected("browser");
      expect(connections.getSnapshot().holders).toEqual([]);
      await connections.connect("usb");
      expect(connections.getSnapshot().holders).toMatchObject([{ kind: "browser", canFree: false }]);
      expect(connections.getSnapshot().error).toBeNull();
    });

    it("names what's holding the port when USB can't connect", async () => {
      const { connections } = await connected("other");
      await connections.connect("usb");
      const [holder] = connections.getSnapshot().holders;
      expect(describeHolder(holder!)).toBe("SomeApp (pid 4244) has this boot open. Quit it to connect here.");
      expect(holder!.canFree).toBe(false);
    });

    it("falls back to the connection's own error when nothing is named, as in a built copy", async () => {
      const noServer: BootPortsClient = { list: async () => Promise.reject(new Error("no server")), free: async () => ({ freed: false }) };
      const transport = new FakeBootTransport([new FakeBoot()], new FakeBootPorts("tool"));
      const connections = new BootConnections(async () => transport, noServer);
      await connections.prepare();
      await connections.connect("usb");
      expect(connections.getSnapshot().error).toMatch(/Couldn't open/);
    });

    it("closes our tool and connects", async () => {
      const { ports, connections } = await connected("tool");
      await connections.free(connections.getSnapshot().holders[0]!);
      expect(ports.freed).toEqual([4242]);
      expect(connections.getSnapshot()).toMatchObject({ holders: [], error: null, freeing: null });
      expect(connections.getSnapshot().boots).toHaveLength(1);
    });

    it("says what to press if the browser won't show its picker after closing", async () => {
      const ports = new FakeBootPorts("tool");
      const transport = new FakeBootTransport([new FakeBoot()], ports);
      const connections = new BootConnections(async () => transport, ports);
      await connections.prepare();
      vi.spyOn(transport, "pick").mockResolvedValue(null);
      await connections.free(connections.getSnapshot().holders[0]!);
      expect(connections.getSnapshot().hint).toMatch(/port's free\. Press Connect over USB/);
    });

    it("says so if the tool won't close", async () => {
      const ports: BootPortsClient = {
        list: async () => new FakeBootPorts("tool").holders,
        free: async () => ({ freed: false, error: "./cli didn't close." }),
      };
      const connections = new BootConnections(async () => new FakeBootTransport([new FakeBoot()]), ports);
      await connections.prepare();
      await connections.free(connections.getSnapshot().holders[0]!);
      expect(connections.getSnapshot()).toMatchObject({ error: "./cli didn't close.", boots: [] });
    });

    it("says it's usually the phone app when a Bluetooth boot isn't in the picker", async () => {
      const transport = new FakeBootTransport([new FakeBoot()]);
      const connections = new BootConnections(async () => transport, new FakeBootPorts());
      await connections.prepare();
      vi.spyOn(transport, "pick").mockResolvedValue(null);
      await connections.connect("bluetooth");
      expect(connections.getSnapshot().hint).toMatch(/one Bluetooth connection at a time.*phone app.*connect over USB/);
    });

    it("says it's usually the phone app when Bluetooth can't connect", async () => {
      const transport = new FakeBootTransport([new FakeBoot()]);
      const connections = new BootConnections(async () => transport, new FakeBootPorts());
      await connections.prepare();
      vi.spyOn(transport, "open").mockRejectedValue(new Error("timed out"));
      await connections.connect("bluetooth");
      expect(connections.getSnapshot().error).toMatch(/one Bluetooth connection at a time/);
    });

    it("words each kind of holder plainly", () => {
      const base = { port: "/dev/cu.usbmodem1", pid: 1234, process: "x", canFree: false };
      expect(describeHolder({ ...base, kind: "tool", name: "./cli", canFree: true })).toBe("./cli (pid 1234) has this boot open.");
      expect(describeHolder({ ...base, kind: "browser", name: "A browser tab" })).toMatch(/^Another browser tab has this boot open/);
    });
  });

  it("says when boots can't be reached from this browser", async () => {
    const connections = new BootConnections(async () => {
      throw new Error("no Bluetooth");
    });
    await connections.prepare();
    expect(connections.getSnapshot().error).toMatch(/no Bluetooth/);
  });
});
