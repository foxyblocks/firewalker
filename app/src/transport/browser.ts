/**
 * Both ways a desktop browser can reach a boot, behind one Transport, so a pair can be one boot
 * on Bluetooth and one on USB. Find boots shows a button per way (`pickers`), and from then on
 * the device id says which way a boot is connected: `usb:3EB5` goes to `UsbTransport`, and
 * anything else to `BleTransport`. `setup.ts` only uses this in a browser with Web Serial.
 */

import { isUsbBoot, type BootLink, type FoundBoot, type LinkEvents, type PickMethod, type RadioState, type Transport } from "./transport";

export class BrowserTransport implements Transport {
  readonly simulated = false;
  readonly finding = "picker" as const;
  readonly pickers = ["bluetooth", "usb"] as const;

  constructor(
    private readonly bluetooth: Transport,
    private readonly usb: Transport,
  ) {}

  /**
   * Reports "on" whatever Bluetooth's state, because the app is still useful over USB. This
   * still asks Bluetooth, since asking is what starts it for any boots saved on Bluetooth.
   */
  async radioState(): Promise<RadioState> {
    await this.bluetooth.radioState();
    return this.usb.radioState();
  }

  openSettings(): Promise<void> {
    return this.bluetooth.openSettings();
  }

  startScan(onFound: (boot: FoundBoot) => void): Promise<void> {
    return this.bluetooth.startScan(onFound);
  }

  stopScan(): Promise<void> {
    return this.bluetooth.stopScan();
  }

  /** Bluetooth unless told otherwise, since only Bluetooth boots ever need picking again. */
  pick(method: PickMethod = "bluetooth"): Promise<FoundBoot | null> {
    return method === "usb" ? this.usb.pick() : this.bluetooth.pick();
  }

  open(deviceId: string, events: LinkEvents): Promise<BootLink> {
    return isUsbBoot(deviceId) ? this.usb.open(deviceId, events) : this.bluetooth.open(deviceId, events);
  }
}
