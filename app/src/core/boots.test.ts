// Tests BootsStore through its interface, with FakeBoots behind the real BootClient.
import { BootsStore, type KeyValueStore } from "./boots";
import { FakeBoot, FakeTransport } from "../transport/fakeBoot";

const memoryStorage = (initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } => ({
  data: initial,
  async get(key) {
    return this.data[key] ?? null;
  },
  async set(key, value) {
    this.data[key] = value;
  },
});

const settle = () => vi.advanceTimersByTimeAsync(400);

const pair = async (
  leftOptions: ConstructorParameters<typeof FakeBoot>[0] = {},
  rightOptions: ConstructorParameters<typeof FakeBoot>[0] = {},
) => {
  const left = new FakeBoot({ id: "3ED1", ...leftOptions });
  const right = new FakeBoot({ id: "7B20", ...rightOptions });
  const storage = memoryStorage();
  const transport = new FakeTransport([left, right]);
  const store = new BootsStore(transport, storage);
  await store.load();
  store.assign({ deviceId: left.deviceId, name: left.name }, "left");
  store.assign({ deviceId: right.deviceId, name: right.name }, "right");
  await settle();
  return { left, right, store, storage, transport };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("moving a boot between Bluetooth and USB", () => {
  it("keeps its side and your name for it, and connects the new way", async () => {
    const { left, store, storage } = await pair();
    store.rename("left", "Stompy");

    left.deviceId = "usb:3ED1";
    store.assign({ deviceId: "usb:3ED1", name: left.name }, "left");
    await settle();

    expect(store.known("left")).toMatchObject({ deviceId: "usb:3ED1", nickname: "Stompy" });
    expect(store.client("left")?.getState().link).toBe("online");
    // Saved, so a reload connects over USB rather than going back to Bluetooth.
    expect(JSON.parse(storage.data.boots!)[0]).toMatchObject({ side: "left", deviceId: "usb:3ED1" });
  });

  it("can't leave the same boot on both sides", async () => {
    const { left, right, store } = await pair();

    left.deviceId = "usb:3ED1";
    store.assign({ deviceId: "usb:3ED1", name: left.name }, "right");
    await settle();

    expect(store.known("right")?.name).toBe(left.name);
    expect(store.known("left")?.name).toBe(right.name);
    expect(store.client("right")?.getState().status?.id).toBe("3ED1");
    expect(store.client("left")?.getState().status?.id).toBe("7B20");
  });

  it("doesn't mistake a boot with no name yet for one you've labeled", async () => {
    const storage = memoryStorage();
    const first = new FakeBoot({ id: "3ED1" });
    const second = new FakeBoot({ id: "7B20" });
    const store = new BootsStore(new FakeTransport([first, second]), storage);
    await store.load();
    store.assign({ deviceId: first.deviceId, name: "Firewalker" }, "left");
    store.assign({ deviceId: second.deviceId, name: "Firewalker" }, "right");
    await settle();
    expect(store.known("left")?.deviceId).toBe(first.deviceId);
    expect(store.known("right")?.deviceId).toBe(second.deviceId);
  });
});

describe("knowing the boots", () => {
  it("starts empty on first launch", async () => {
    const store = new BootsStore(new FakeTransport([]), memoryStorage());
    await store.load();
    expect(store.sides()).toEqual([]);
  });

  it("remembers labels across launches and reconnects on its own", async () => {
    const { left, right, storage } = await pair({ pattern: "fire-stomp" });
    left.detach();
    right.detach();

    const relaunched = new BootsStore(new FakeTransport([left, right]), storage);
    await relaunched.load();
    await settle();

    expect(relaunched.sides()).toEqual(["left", "right"]);
    expect(relaunched.client("left")?.getState().status?.pattern).toBe("fire-stomp");
    expect(left.connected && right.connected).toBe(true);
  });

  it("swaps sides when a boot is relabeled onto the other's side", async () => {
    const { left, right, store } = await pair();
    store.assign({ deviceId: left.deviceId, name: left.name }, "right");
    await settle();

    expect(store.known("right")?.deviceId).toBe(left.deviceId);
    expect(store.known("left")?.deviceId).toBe(right.deviceId);
    expect(left.connected && right.connected).toBe(true);
  });

  it("keeps hearing from a boot after a swap and then forgetting the other", async () => {
    const { left, store } = await pair();
    store.assign({ deviceId: left.deviceId, name: left.name }, "right");
    await settle();
    store.forget("left");
    await settle();

    const heard = vi.fn();
    store.subscribe(heard);
    store.client("right")?.setBrightness(30);
    await settle();
    expect(heard).toHaveBeenCalled();
  });

  it("forgets a boot and lets go of its connection", async () => {
    const { right, store } = await pair();
    store.forget("right");
    await settle();

    expect(store.sides()).toEqual(["left"]);
    expect(right.connected).toBe(false);
    expect(store.target).toBe("left");
  });

  it("names a boot by its side until you rename it", async () => {
    const { store, storage } = await pair();
    expect(store.displayName("left")).toBe("Left");

    store.rename("left", "Stompy");
    expect(store.displayName("left")).toBe("Stompy");
    expect(storage.data["boots"]).toContain("Stompy");

    store.rename("left", "  ");
    expect(store.displayName("left")).toBe("Left");
  });
});

describe("blinking from the Find boots list", () => {
  it("connects to an unlabeled boot just long enough to blink it", async () => {
    const boot = new FakeBoot();
    const store = new BootsStore(new FakeTransport([boot]), memoryStorage());
    await store.load();

    const done = store.blinkFound({ deviceId: boot.deviceId, name: boot.name });
    await vi.advanceTimersByTimeAsync(3000);
    await done;

    expect(boot.blinks).toBe(1);
    expect(boot.connected).toBe(false);
    expect(store.sides()).toEqual([]);
  });

  it("keeps the connection when a boot is labeled mid-blink", async () => {
    const boot = new FakeBoot();
    const transport = new FakeTransport([boot]);
    const open = vi.spyOn(transport, "open");
    const store = new BootsStore(transport, memoryStorage());
    await store.load();
    const found = { deviceId: boot.deviceId, name: boot.name };

    const done = store.blinkFound(found);
    await vi.advanceTimersByTimeAsync(500);
    store.assign(found, "left");
    await vi.advanceTimersByTimeAsync(3000);
    await done;

    expect(boot.connected).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(store.client("left")?.getState().link).toBe("online");
  });

  it("uses the existing connection for a labeled boot", async () => {
    const { left, store } = await pair();
    await store.blinkFound({ deviceId: left.deviceId, name: left.name });
    await settle();
    expect(left.blinks).toBe(1);
    expect(left.connected).toBe(true);
  });
});

describe("choosing what a tap controls", () => {
  it("defaults to Both once two boots are known", async () => {
    const { store } = await pair();
    expect(store.target).toBe("both");
  });

  it("sends a Both command to each boot", async () => {
    const { left, right, store } = await pair();
    store.selectPattern("fire-stomp");
    await settle();
    expect(left.pattern).toBe("fire-stomp");
    expect(right.pattern).toBe("fire-stomp");
  });

  it("never touches the other boot from a single tab", async () => {
    const { left, right, store } = await pair();
    store.setTarget("left");

    store.selectPattern("fire-stomp");
    store.setPower(false);
    store.setBrightness(40);
    await settle();

    expect(left.pattern).toBe("off");
    expect(left.brightness).toBe(40);
    expect(right.pattern).toBe("rainbow-pool");
    expect(right.brightness).toBe(24);
    expect(right.received.filter((line) => line !== "status" && line !== "patterns" && line !== "audio")).toEqual([]);
  });

  it("drives whichever boot is online, and says which isn't", async () => {
    const { left, right, store } = await pair();
    right.reachable = false;
    right.dropLink();
    await settle();

    store.selectPattern("fire-stomp");
    await settle();

    expect(left.pattern).toBe("fire-stomp");
    expect(store.view().offline).toEqual(["right"]);
  });
});

describe("the pattern tiles", () => {
  it("shows every pattern, and which boots are running each", async () => {
    const { store } = await pair({ pattern: "rainbow-pool" }, { pattern: "fire-stomp" });
    expect(store.view().tiles).toEqual([
      { id: "rainbow-pool", runningOn: ["left"], missingOn: [] },
      { id: "fire-stomp", runningOn: ["right"], missingOn: [] },
    ]);
  });

  it("marks a pattern only one boot has", async () => {
    const { store } = await pair(
      { patterns: ["rainbow-pool", "fire-stomp", "pattern-3"] },
      { patterns: ["rainbow-pool", "fire-stomp"] },
    );
    expect(store.view().tiles.at(-1)).toEqual({ id: "pattern-3", runningOn: [], missingOn: ["right"] });
  });

  it("only shows the chosen boot's patterns on its own tab", async () => {
    const { store } = await pair(
      { patterns: ["rainbow-pool", "fire-stomp", "pattern-3"] },
      { patterns: ["rainbow-pool", "fire-stomp"] },
    );
    store.setTarget("right");
    expect(store.view().tiles.map((tile) => tile.id)).toEqual(["rainbow-pool", "fire-stomp"]);
  });

  it("sends a one-boot pattern to that boot and names the one that can't run it", async () => {
    const { left, right, store } = await pair(
      { patterns: ["rainbow-pool", "pattern-3"] },
      { patterns: ["rainbow-pool"] },
    );
    store.selectPattern("pattern-3");
    await settle();

    expect(left.pattern).toBe("pattern-3");
    expect(right.pattern).toBe("rainbow-pool");
    expect(right.received).not.toContain("pattern pattern-3");
    expect(store.view().needsUpdate).toEqual({ pattern: "pattern-3", sides: ["right"] });
  });

  it("clears that message once you choose something both can run", async () => {
    const { store } = await pair({ patterns: ["rainbow-pool", "pattern-3"] }, { patterns: ["rainbow-pool"] });
    store.selectPattern("pattern-3");
    await settle();
    store.selectPattern("rainbow-pool");
    expect(store.view().needsUpdate).toBeUndefined();
  });

  it("keeps showing the patterns of a boot that went offline", async () => {
    const { left, store } = await pair({ patterns: ["rainbow-pool", "pattern-3"] });
    store.setTarget("left");
    left.reachable = false;
    left.dropLink();
    await settle();

    expect(store.view().tiles.map((tile) => tile.id)).toEqual(["rainbow-pool", "pattern-3"]);
    expect(store.view().controllable).toBe(false);
  });

  it("shows which pattern turning on will bring back, before the boot confirms", async () => {
    const { store } = await pair({ pattern: "off", lastLit: "fire-stomp" }, { pattern: "off", lastLit: "rainbow-pool" });
    store.setPower(true);
    expect(store.view().tiles).toEqual([
      { id: "rainbow-pool", runningOn: ["right"], missingOn: [] },
      { id: "fire-stomp", runningOn: ["left"], missingOn: [] },
    ]);
  });

  it("shows a pending choice right away", async () => {
    const { store } = await pair();
    store.selectPattern("fire-stomp");
    expect(store.view().tiles.find((tile) => tile.id === "fire-stomp")?.runningOn).toEqual(["left", "right"]);
  });
});

describe("calibrating and naming", () => {
  it("names a boot from its own id, even if the scan had no name yet", async () => {
    const boot = new FakeBoot({ id: "3ED8" });
    const store = new BootsStore(new FakeTransport([boot]), memoryStorage());
    await store.load();
    store.assign({ deviceId: boot.deviceId, name: "Firewalker" }, "left");
    expect(store.bootName("left")).toBe("Firewalker");

    await settle();
    expect(store.bootName("left")).toBe("Firewalker-3ED8");
  });
});

describe("power and brightness on Both", () => {
  it("reads as on if either boot is lit, and turns both off", async () => {
    const { left, right, store } = await pair({ pattern: "off" }, { pattern: "rainbow-pool" });
    expect(store.view().on).toBe(true);

    store.setPower(false);
    await settle();
    expect(left.pattern).toBe("off");
    expect(right.pattern).toBe("off");
    expect(store.view().on).toBe(false);
  });

  it("shows Left's brightness and a drag sets both to match", async () => {
    const { left, right, store } = await pair({ brightness: 10 }, { brightness: 50 });
    expect(store.view().brightness).toBe(10);

    store.setDragging(true);
    store.setBrightness(30);
    store.setDragging(false);
    await settle();

    expect(left.brightness).toBe(30);
    expect(right.brightness).toBe(30);
  });

  it("caps the slider at the lower of the two limits", async () => {
    const { store } = await pair({ maxBrightness: 64 }, { maxBrightness: 48 });
    expect(store.view().maxBrightness).toBe(48);
  });
});

describe("the soft brightness cap", () => {
  const CAP = { capBrightness: 96, maxBrightness: 255 };

  it("shows the cap on, and turns it off on both boots", async () => {
    const { left, right, store } = await pair(CAP, CAP);
    expect(store.view().capped).toBe(true);
    expect(store.view().maxBrightness).toBe(96);
    expect(store.view().capBrightness).toBe(96);

    store.setCap(false);
    expect(store.view().capped).toBe(false);
    await settle();
    expect(left.capped).toBe(false);
    expect(right.capped).toBe(false);
    expect(store.view().maxBrightness).toBe(255);
  });

  it("reads as off when either boot is uncapped, so one tap caps both", async () => {
    const { left, right, store } = await pair({ ...CAP, capped: false, brightness: 200 }, CAP);
    expect(store.view().capped).toBe(false);

    store.setCap(true);
    await settle();
    expect(left.capped).toBe(true);
    expect(right.capped).toBe(true);
    expect(left.brightness).toBe(96);
  });

  it("offers no cap for firmware without one, and never sends it the command", async () => {
    const { right, store } = await pair(CAP, {});
    store.setTarget("right");
    expect(store.view().capped).toBeUndefined();
    expect(store.view().capBrightness).toBeUndefined();

    store.setTarget("both");
    expect(store.view().capped).toBe(true);
    store.setCap(false);
    await settle();
    expect(right.received).not.toContain("cap off");
  });
});

describe("the save and warning summary", () => {
  it("says saving while a boot has unsaved changes, then saved", async () => {
    const { store } = await pair();
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.view().saving).toBe(false);

    store.setBrightness(30);
    await settle();
    expect(store.view().saving).toBe(true);

    await vi.advanceTimersByTimeAsync(1500);
    expect(store.view().saving).toBe(false);
  });

  it("names a boot whose save failed", async () => {
    const { store } = await pair({ saveFails: true });
    store.setBrightness(30);
    await vi.advanceTimersByTimeAsync(1800);
    expect(store.view().saveFailed).toEqual(["left"]);
  });

  it("names a boot whose motion sensor is unavailable", async () => {
    const { store } = await pair({}, { sensor: "unavailable" });
    expect(store.view().sensorMissing).toEqual(["right"]);
  });

  it("lists the boots not calibrated yet", async () => {
    const { store } = await pair({ calibrated: true }, { calibrated: false });
    expect(store.view().uncalibrated).toEqual(["right"]);
  });

  it("names boots the browser lost access to, apart from ones reconnecting", async () => {
    const { store, left, right } = await pair();
    await store.client("left")!.disconnect();
    left.accessLost = true;
    store.client("left")!.connect();
    right.dropLink();
    right.reachable = false;
    await settle();
    expect(store.view().accessLost).toEqual(["left"]);
    expect(store.view().offline).toEqual(["right"]);
  });

  it("names a boot whose firmware is too old for this app", async () => {
    const { store } = await pair({}, { proto: 0 });
    expect(store.view().outdated).toEqual(["right"]);
  });

  it("names a boot that didn't answer", async () => {
    const { right, store } = await pair();
    right.unresponsive = true;
    store.selectPattern("fire-stomp");
    await vi.advanceTimersByTimeAsync(2100);
    expect(store.view().noAnswer).toEqual(["right"]);
  });
});

describe("restoring browser access", () => {
  // Chrome without its permissions flag forgets a boot on reload, and hands out a new handle
  // when it's picked again, so only the name says which saved boot it is.
  const lostAfterReload = async () => {
    const paired = await pair();
    paired.store.rename("left", "Stompy");
    await paired.store.client("left")!.disconnect();
    paired.left.accessLost = true;
    paired.store.client("left")!.connect();
    await settle();
    return paired;
  };

  it("reconnects the picked boot on the same side, under its own name", async () => {
    const { store, left } = await lostAfterReload();
    const staleId = store.known("left")!.deviceId;

    await store.restoreAccess();
    await settle();

    expect(store.known("left")!.deviceId).toBe(left.deviceId);
    expect(store.known("left")!.deviceId).not.toBe(staleId);
    expect(store.displayName("left")).toBe("Stompy");
    expect(store.client("left")!.getState().link).toBe("online");
    expect(store.view().accessLost).toEqual([]);
  });

  it("saves the new handle, so the next launch finds it", async () => {
    const { store, storage, left } = await lostAfterReload();
    await store.restoreAccess();
    const saved = JSON.parse((await storage.get("boots"))!) as { side: string; deviceId: string }[];
    expect(saved.find((boot) => boot.side === "left")!.deviceId).toBe(left.deviceId);
  });

  it("leaves everything alone when the picker is cancelled", async () => {
    const { store, transport } = await lostAfterReload();
    vi.spyOn(transport, "pick").mockResolvedValueOnce(null);
    await store.restoreAccess();
    await settle();
    expect(store.view().accessLost).toEqual(["left"]);
  });

  it("ignores a boot that isn't one of yours", async () => {
    const { store, transport } = await lostAfterReload();
    vi.spyOn(transport, "pick").mockResolvedValueOnce({ deviceId: "stranger", name: "Firewalker-0000" });
    await store.restoreAccess();
    await settle();
    expect(store.view().accessLost).toEqual(["left"]);
  });
});
