/**
 * The seam between the app and the radio. Everything above this interface works in
 * lines of text and doesn't know whether a real boot is on the other end, which is
 * what lets `fakeBoot.ts` exercise all of the real client code.
 *
 * `ble.ts` implements it with the Capacitor Bluetooth plugin, for both iOS Bluetooth
 * on the iPhone and Web Bluetooth in Chrome. `fakeBoot.ts` implements it in memory.
 */

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
  /** True when these are pretend boots, so the UI can say so. */
  readonly simulated: boolean;

  radioState(): Promise<RadioState>;
  startScan(onFound: (boot: FoundBoot) => void): Promise<void>;
  stopScan(): Promise<void>;
  /** Shows the system's picker. Resolves null if the person cancels. */
  pick(): Promise<FoundBoot | null>;
  /** Connects to a boot and subscribes to its replies. Rejects if it can't reach it. */
  open(deviceId: string, events: LinkEvents): Promise<BootLink>;
}
