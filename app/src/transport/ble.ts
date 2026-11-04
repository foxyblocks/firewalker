/**
 * The real radio: the Transport seam implemented with the Capacitor Bluetooth plugin.
 * The plugin covers iOS Bluetooth on the iPhone and Web Bluetooth in Chrome, so this one
 * file is the app's whole Bluetooth surface, and the two platforms only differ in how
 * boots get found:
 * - iOS scans and reports boots as they appear.
 * - Chrome shows its own picker, one boot per tap, because scanning sits behind a flag.
 */

import { Capacitor } from "@capacitor/core";
import { BleClient, dataViewToText, textToDataView } from "@capacitor-community/bluetooth-le";
import { BOOT_NAME_PREFIX, BOOT_RX, BOOT_SERVICE, BOOT_TX } from "../core/protocol";
import type { BootLink, FoundBoot, LinkEvents, RadioState, Transport } from "./transport";

const CONNECT_TIMEOUT_MS = 8000;

export class BleTransport implements Transport {
  readonly simulated = false;
  readonly finding = Capacitor.isNativePlatform() ? ("scan" as const) : ("picker" as const);

  private started: Promise<void> | null = null;

  constructor() {
    // The plugin's default queue runs one call at a time across all devices, so a connect
    // to a boot that's switched off would hold up every command to the boot that's on.
    // Each BootClient already keeps its own boot to one command at a time.
    BleClient.disableQueue();
  }

  /**
   * Starts Bluetooth, once. On iOS, each `initialize` builds a new Bluetooth manager and
   * discards the old one along with any scan or connection it was running, so checking
   * Bluetooth must never call it twice. A failed start is forgotten, so Try again can
   * retry it.
   */
  private start(): Promise<void> {
    this.started ??= BleClient.initialize().catch((error: unknown) => {
      this.started = null;
      throw error;
    });
    return this.started;
  }

  /**
   * Reports whether Bluetooth can be used, starting it if needed. On iOS, the first start
   * is what shows the permission prompt. The plugin signals each failure with its error
   * text. This runs whenever the app returns to the foreground, so it has to be harmless
   * to call while boots are connected.
   */
  async radioState(): Promise<RadioState> {
    try {
      await this.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/denied|unauthorized/i.test(message)) return "denied";
      if (/unsupported|not available/i.test(message)) return "unsupported";
      return "off";
    }
    return (await BleClient.isEnabled().catch(() => false)) ? "on" : "off";
  }

  async openSettings(): Promise<void> {
    await BleClient.openAppSettings().catch(() => undefined);
  }

  async startScan(onFound: (boot: FoundBoot) => void): Promise<void> {
    await BleClient.requestLEScan({ services: [BOOT_SERVICE] }, (result) => {
      // iOS can cache an old GAP name, so the advertised name comes first. The firmware
      // puts its name in the scan response, which can arrive after the advertisement, and
      // the scan already filters on the boot's service, so a result with no name yet is
      // still a boot. It only gets dropped if it's named as something else.
      const name = result.localName ?? result.device.name;
      if (name && !name.startsWith(BOOT_NAME_PREFIX)) return;
      onFound({ deviceId: result.device.deviceId, name: name ?? "Firewalker", rssi: result.rssi });
    });
  }

  async stopScan(): Promise<void> {
    await BleClient.stopLEScan().catch(() => undefined);
  }

  /** Resolves null when the person cancels Chrome's picker, which the plugin throws for. */
  async pick(): Promise<FoundBoot | null> {
    try {
      const device = await BleClient.requestDevice({ services: [BOOT_SERVICE] });
      return { deviceId: device.deviceId, name: device.name ?? "Firewalker" };
    } catch {
      return null;
    }
  }

  async open(deviceId: string, events: LinkEvents): Promise<BootLink> {
    // After a relaunch, iOS has to be told about a saved device before connecting to it.
    if (Capacitor.isNativePlatform()) await BleClient.getDevices([deviceId]);

    await BleClient.connect(deviceId, () => events.onClosed(), { timeout: CONNECT_TIMEOUT_MS });
    try {
      await BleClient.startNotifications(deviceId, BOOT_SERVICE, BOOT_TX, (value) =>
        events.onData(dataViewToText(value)),
      );
    } catch (error) {
      await BleClient.disconnect(deviceId).catch(() => undefined);
      throw error;
    }

    return {
      write: (line) => BleClient.write(deviceId, BOOT_SERVICE, BOOT_RX, textToDataView(line)),
      close: () => BleClient.disconnect(deviceId),
    };
  }
}
