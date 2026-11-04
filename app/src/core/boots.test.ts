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
  const store = new BootsStore(new FakeTransport([left, right]), storage);
  await store.load();
  store.assign({ deviceId: left.deviceId, name: left.name }, "left");
  store.assign({ deviceId: right.deviceId, name: right.name }, "right");
  await settle();
  return { left, right, store, storage };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("knowing the boots", () => {
  it("starts empty on first launch", async () => {
    const store = new BootsStore(new FakeTransport([]), memoryStorage());
    await store.load();
    expect(store.sides()).toEqual([]);
  });

  it("remembers labels across launches and reconnects on its own", async () => {
    const { left, right, storage } = await pair({ pattern: "fire-trail" });
    left.detach();
    right.detach();

    const relaunched = new BootsStore(new FakeTransport([left, right]), storage);
    await relaunched.load();
    await settle();

    expect(relaunched.sides()).toEqual(["left", "right"]);
    expect(relaunched.client("left")?.getState().status?.pattern).toBe("fire-trail");
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
    store.selectPattern("fire-trail");
    await settle();
    expect(left.pattern).toBe("fire-trail");
    expect(right.pattern).toBe("fire-trail");
  });

  it("never touches the other boot from a single tab", async () => {
    const { left, right, store } = await pair();
    store.setTarget("left");

    store.selectPattern("fire-trail");
    store.setPower(false);
    store.setBrightness(40);
    await settle();

    expect(left.pattern).toBe("off");
    expect(left.brightness).toBe(40);
    expect(right.pattern).toBe("flow");
    expect(right.brightness).toBe(24);
    expect(right.received.filter((line) => line !== "status" && line !== "patterns")).toEqual([]);
  });

  it("drives whichever boot is online, and says which isn't", async () => {
    const { left, right, store } = await pair();
    right.reachable = false;
    right.dropLink();
    await settle();

    store.selectPattern("fire-trail");
    await settle();

    expect(left.pattern).toBe("fire-trail");
    expect(store.view().offline).toEqual(["right"]);
  });
});

describe("the pattern tiles", () => {
  it("shows every pattern, and which boots are running each", async () => {
    const { store } = await pair({ pattern: "flow" }, { pattern: "fire-trail" });
    expect(store.view().tiles).toEqual([
      { id: "flow", runningOn: ["left"], missingOn: [] },
      { id: "fire-trail", runningOn: ["right"], missingOn: [] },
    ]);
  });

  it("marks a pattern only one boot has", async () => {
    const { store } = await pair(
      { patterns: ["flow", "fire-trail", "pattern-3"] },
      { patterns: ["flow", "fire-trail"] },
    );
    expect(store.view().tiles.at(-1)).toEqual({ id: "pattern-3", runningOn: [], missingOn: ["right"] });
  });

  it("only shows the chosen boot's patterns on its own tab", async () => {
    const { store } = await pair(
      { patterns: ["flow", "fire-trail", "pattern-3"] },
      { patterns: ["flow", "fire-trail"] },
    );
    store.setTarget("right");
    expect(store.view().tiles.map((tile) => tile.id)).toEqual(["flow", "fire-trail"]);
  });

  it("sends a one-boot pattern to that boot and names the one that can't run it", async () => {
    const { left, right, store } = await pair(
      { patterns: ["flow", "pattern-3"] },
      { patterns: ["flow"] },
    );
    store.selectPattern("pattern-3");
    await settle();

    expect(left.pattern).toBe("pattern-3");
    expect(right.pattern).toBe("flow");
    expect(right.received).not.toContain("pattern pattern-3");
    expect(store.view().needsUpdate).toEqual({ pattern: "pattern-3", sides: ["right"] });
  });

  it("clears that message once you choose something both can run", async () => {
    const { store } = await pair({ patterns: ["flow", "pattern-3"] }, { patterns: ["flow"] });
    store.selectPattern("pattern-3");
    await settle();
    store.selectPattern("flow");
    expect(store.view().needsUpdate).toBeUndefined();
  });

  it("shows a pending choice right away", async () => {
    const { store } = await pair();
    store.selectPattern("fire-trail");
    expect(store.view().tiles.find((tile) => tile.id === "fire-trail")?.runningOn).toEqual(["left", "right"]);
  });
});

describe("power and brightness on Both", () => {
  it("reads as on if either boot is lit, and turns both off", async () => {
    const { left, right, store } = await pair({ pattern: "off" }, { pattern: "flow" });
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

  it("names a boot that didn't answer", async () => {
    const { right, store } = await pair();
    right.unresponsive = true;
    store.selectPattern("fire-trail");
    await vi.advanceTimersByTimeAsync(2100);
    expect(store.view().noAnswer).toEqual(["right"]);
  });
});
