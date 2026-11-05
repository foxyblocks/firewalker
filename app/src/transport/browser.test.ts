// Tests that a desktop browser sends each boot to the right way of reaching it.
import { BrowserTransport } from "./browser";
import type { RadioState, Transport } from "./transport";

const NO_EVENTS = { onData: () => undefined, onClosed: () => undefined };

function pretendTransport(radio: RadioState, deviceId: string) {
  return {
    finding: "picker",
    pickers: [],
    simulated: false,
    radioState: vi.fn(async () => radio),
    openSettings: vi.fn(async () => undefined),
    startScan: vi.fn(async () => undefined),
    stopScan: vi.fn(async () => undefined),
    pick: vi.fn(async () => ({ deviceId, name: "Firewalker-3EB5" })),
    open: vi.fn(async () => ({ write: async () => undefined, close: async () => undefined })),
  } satisfies Transport;
}

describe("a desktop browser", () => {
  it("offers both ways of adding a boot", () => {
    const transport = new BrowserTransport(pretendTransport("on", "ble"), pretendTransport("on", "usb:3EB5"));
    expect(transport.pickers).toEqual(["bluetooth", "usb"]);
  });

  it("picks with whichever way was asked for, and Bluetooth for a plain pick", async () => {
    const bluetooth = pretendTransport("on", "ble");
    const usb = pretendTransport("on", "usb:3EB5");
    const transport = new BrowserTransport(bluetooth, usb);
    await expect(transport.pick("usb")).resolves.toMatchObject({ deviceId: "usb:3EB5" });
    await expect(transport.pick("bluetooth")).resolves.toMatchObject({ deviceId: "ble" });
    await expect(transport.pick()).resolves.toMatchObject({ deviceId: "ble" });
  });

  it("connects each boot the way its device id says", async () => {
    const bluetooth = pretendTransport("on", "ble");
    const usb = pretendTransport("on", "usb:3EB5");
    const transport = new BrowserTransport(bluetooth, usb);
    await transport.open("usb:3EB5", NO_EVENTS);
    expect(usb.open).toHaveBeenCalledWith("usb:3EB5", NO_EVENTS);
    expect(bluetooth.open).not.toHaveBeenCalled();
    await transport.open("AA:BB", NO_EVENTS);
    expect(bluetooth.open).toHaveBeenCalledWith("AA:BB", NO_EVENTS);
  });

  it("stays usable with Bluetooth off, since USB still works", async () => {
    const bluetooth = pretendTransport("off", "ble");
    const transport = new BrowserTransport(bluetooth, pretendTransport("on", "usb:3EB5"));
    await expect(transport.radioState()).resolves.toBe("on");
    expect(bluetooth.radioState).toHaveBeenCalled();
  });
});
