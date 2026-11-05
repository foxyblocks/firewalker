/**
 * The seam between the app and the boots. Everything above this interface works in
 * lines of text and doesn't know whether a real boot is on the other end, which is
 * what lets `fakeBoot.ts` exercise all of the real client code.
 *
 * `ble.ts` implements it with the Capacitor Bluetooth plugin, for both iOS Bluetooth
 * on the iPhone and Web Bluetooth in Chrome. `usb.ts` implements it with Web Serial, for a
 * boot plugged into a computer, and `browser.ts` offers both in a desktop browser.
 * `fakeBoot.ts` implements it in memory.
 */

/**
 * The browser no longer lets this page reach a boot, which is what a page reload does in a
 * browser that can't remember boots. Retrying can't fix it, because only the system picker
 * can grant access again (`Transport.pick`, which needs a tap).
 */
export class AccessLostError extends Error {
  constructor() {
    super("The browser no longer has access to this boot");
    this.name = "AccessLostError";
  }
}

/** A way of picking a boot, which is a button on Find boots when a browser offers several. */
export type PickMethod = "bluetooth" | "usb";

/** The device id of a boot on USB, from the `id` in its status line, such as `usb:3EB5`. */
export const usbDeviceId = (bootId: string) => `usb:${bootId}`;

/** True for a device id from `usbDeviceId`. */
export const isUsbBoot = (deviceId: string) => deviceId.startsWith("usb:");

export interface FoundBoot {
  /** This device's handle for the boot. On iOS it only means something on this phone. */
  deviceId: string;
  /** The advertised name, such as Firewalker-3ED1, whose suffix is the boot's id. */
  name: string;
  /** Signal strength in dBm, when the platform reports it. */
  rssi?: number;
}

export interface LinkEvents {
  /** Text received from the boot. It may hold part of a line, or several lines. */
  onData(text: string): void;
  /** The connection ended, for any reason. */
  onClosed(): void;
}

export interface BootLink {
  /** Sends one command. Rejects if the write fails or the link is gone. */
  write(line: string): Promise<void>;
  close(): Promise<void>;
}

export type RadioState = "on" | "off" | "denied" | "unsupported";

export interface Transport {
  /**
   * How boots get found. "scan" reports boots as they appear, as on the iPhone.
   * "picker" asks the system for one boot per tap, as Chrome's Web Bluetooth does.
   */
  readonly finding: "scan" | "picker";
  /** The ways `pick` can find a boot here. The first is what a plain `pick()` uses. */
  readonly pickers: readonly PickMethod[];
  /** True when these are pretend boots, so the UI can say so. */
  readonly simulated: boolean;

  radioState(): Promise<RadioState>;
  /** Opens this app's page in iOS Settings, for turning Bluetooth access back on. */
  openSettings(): Promise<void>;
  startScan(onFound: (boot: FoundBoot) => void): Promise<void>;
  stopScan(): Promise<void>;
  /**
   * Shows the system's picker. Resolves null if the person cancels. Rejects, with a message
   * to show them, if they picked a boot that can't be reached.
   */
  pick(method?: PickMethod): Promise<FoundBoot | null>;
  /**
   * Connects to a boot and subscribes to its replies. Rejects if it can't reach it, with
   * AccessLostError when trying again won't help.
   */
  open(deviceId: string, events: LinkEvents): Promise<BootLink>;
}
