import { BleClient } from "@capacitor-community/bluetooth-le";
import { BleTransport } from "./ble";
import { AccessLostError } from "./transport";

// The browser side of the radio, on its own because the iOS tests mock a native platform.
// These stand in for what Chrome 157 did with a real boot: a boot it remembers can only be
// connected to after it's been heard advertising, and without the permissions flag there's
// no `getDevices` at all, so a reload forgets every boot.
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@capacitor-community/bluetooth-le", () => ({
  BleClient: {
    disableQueue: vi.fn(),
    getDevices: vi.fn(async () => []),
    requestDevice: vi.fn(async () => ({ deviceId: "picked", name: "Firewalker-3ED8" })),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    startNotifications: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
  },
  dataViewToText: vi.fn(),
  textToDataView: vi.fn(),
}));

const client = vi.mocked(BleClient);
const EVENTS = { onData: () => undefined, onClosed: () => undefined };

/** A boot the browser remembers, which stays quiet until a test says it advertised. */
function rememberedBoot(id: string) {
  const heard = new Set<() => void>();
  let signal: AbortSignal | undefined;
  return {
    id,
    addEventListener: (_type: string, listener: () => void) => heard.add(listener),
    removeEventListener: (_type: string, listener: () => void) => heard.delete(listener),
    watchAdvertisements: async (options: { signal: AbortSignal }) => {
      signal = options.signal;
    },
    advertise: () => heard.forEach((listener) => listener()),
    stoppedWatching: () => signal?.aborted,
  };
}

const browserRemembers = (...boots: ReturnType<typeof rememberedBoot>[]) =>
  vi.stubGlobal("navigator", { bluetooth: { getDevices: async () => boots } });
const browserForgets = () => vi.stubGlobal("navigator", { bluetooth: {} });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connecting after a page reload", () => {
  it("waits to hear the boot advertise, then connects", async () => {
    const boot = rememberedBoot("3ed8");
    browserRemembers(boot);
    const opening = new BleTransport().open("3ed8", EVENTS);

    await vi.advanceTimersByTimeAsync(100);
    expect(client.getDevices).toHaveBeenCalledWith(["3ed8"]);
    expect(client.connect).not.toHaveBeenCalled();

    boot.advertise();
    await opening;
    expect(client.connect).toHaveBeenCalledWith("3ed8", expect.anything(), expect.anything());
    expect(boot.stoppedWatching()).toBe(true);
  });

  it("tries again later if the boot stays quiet, such as when it's connected elsewhere", async () => {
    const boot = rememberedBoot("3ed8");
    browserRemembers(boot);
    const opening = new BleTransport().open("3ed8", EVENTS);
    const failure = expect(opening).rejects.not.toBeInstanceOf(AccessLostError);

    await vi.advanceTimersByTimeAsync(8000);
    await failure;
    expect(client.connect).not.toHaveBeenCalled();
    expect(boot.stoppedWatching()).toBe(true);
  });

  it("reports lost access when the browser doesn't remember this boot", async () => {
    browserRemembers(rememberedBoot("someone-else"));
    await expect(new BleTransport().open("3ed8", EVENTS)).rejects.toBeInstanceOf(AccessLostError);
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("reports lost access when the browser can't remember boots at all", async () => {
    browserForgets();
    await expect(new BleTransport().open("3ed8", EVENTS)).rejects.toBeInstanceOf(AccessLostError);
    expect(client.connect).not.toHaveBeenCalled();
  });
});

describe("connecting to a boot just picked", () => {
  it("connects straight away in a browser that can't remember boots", async () => {
    browserForgets();
    const transport = new BleTransport();
    await transport.pick();
    await transport.open("picked", EVENTS);
    expect(client.connect).toHaveBeenCalledWith("picked", expect.anything(), expect.anything());
  });

  it("still reports lost access for a boot picked before the reload", async () => {
    browserForgets();
    const transport = new BleTransport();
    await transport.pick();
    await expect(transport.open("older", EVENTS)).rejects.toBeInstanceOf(AccessLostError);
  });
});
