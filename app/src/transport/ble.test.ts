import { BleClient } from "@capacitor-community/bluetooth-le";
import { BleTransport } from "./ble";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor-community/bluetooth-le", () => ({
  BleClient: {
    initialize: vi.fn(async () => undefined),
    isEnabled: vi.fn(async () => true),
    requestLEScan: vi.fn(async () => undefined),
    stopLEScan: vi.fn(async () => undefined),
  },
  dataViewToText: vi.fn(),
  textToDataView: vi.fn(),
}));

const client = vi.mocked(BleClient);

beforeEach(() => vi.clearAllMocks());

describe("checking Bluetooth", () => {
  // On iOS, each initialize builds a new Bluetooth manager and discards the old one, along
  // with any scan or connection it was running.
  it("starts Bluetooth only once, however often it's checked", async () => {
    const transport = new BleTransport();
    await transport.radioState();
    await transport.radioState();
    await transport.radioState();
    expect(client.initialize).toHaveBeenCalledTimes(1);
    expect(client.isEnabled).toHaveBeenCalledTimes(3);
  });

  it("starts it once when two checks overlap", async () => {
    const transport = new BleTransport();
    await Promise.all([transport.radioState(), transport.radioState()]);
    expect(client.initialize).toHaveBeenCalledTimes(1);
  });

  it("reports on or off from whether Bluetooth is enabled", async () => {
    const transport = new BleTransport();
    expect(await transport.radioState()).toBe("on");
    client.isEnabled.mockResolvedValueOnce(false);
    expect(await transport.radioState()).toBe("off");
  });

  it("tries again after a failed start, so Try again can recover", async () => {
    const transport = new BleTransport();
    client.initialize.mockRejectedValueOnce(new Error("BLE permission denied"));
    expect(await transport.radioState()).toBe("denied");
    expect(await transport.radioState()).toBe("on");
    expect(client.initialize).toHaveBeenCalledTimes(2);
  });

  it("recognizes a device with no Bluetooth", async () => {
    const transport = new BleTransport();
    client.initialize.mockRejectedValueOnce(new Error("BLE unsupported"));
    expect(await transport.radioState()).toBe("unsupported");
  });
});

describe("scanning", () => {
  const scanWith = async (result: object) => {
    const onFound = vi.fn();
    await new BleTransport().startScan(onFound);
    const report = client.requestLEScan.mock.calls[0]![1];
    report(result as Parameters<typeof report>[0]);
    return onFound;
  };

  it("reports a boot by its advertised name", async () => {
    const onFound = await scanWith({
      device: { deviceId: "abc", name: "Old cached name" },
      localName: "Firewalker-3EB5",
      rssi: -50,
    });
    expect(onFound).toHaveBeenCalledWith({ deviceId: "abc", name: "Firewalker-3EB5", rssi: -50 });
  });

  // The name is in the scan response, which can arrive after the advertisement. The scan
  // already filters on the boot's service, so a nameless result is still a boot.
  it("still lists a boot whose name hasn't arrived yet", async () => {
    const onFound = await scanWith({ device: { deviceId: "abc" }, rssi: -60 });
    expect(onFound).toHaveBeenCalledWith({ deviceId: "abc", name: "Firewalker", rssi: -60 });
  });

  it("ignores something else using the same service", async () => {
    const onFound = await scanWith({ device: { deviceId: "abc" }, localName: "Someone's sensor", rssi: -60 });
    expect(onFound).not.toHaveBeenCalled();
  });
});
