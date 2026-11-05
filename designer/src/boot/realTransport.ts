// The real ways to reach a boot: the iPhone app's Bluetooth and USB code, used as is, so there's one
// copy of it. This is loaded only when someone connects to a boot, because it pulls in the app's
// Bluetooth plugin. It imports by relative path, not as a package, so the app's own node_modules stays
// where its iOS build expects it. Run `bun install` in app/ once, too.

import { BleTransport } from "../../../app/src/transport/ble";
import { BrowserTransport } from "../../../app/src/transport/browser";
import type { Transport } from "../../../app/src/transport/transport";
import { usbSupported, UsbTransport } from "../../../app/src/transport/usb";

export function createRealTransport(): Transport {
  const bluetooth = new BleTransport();
  return usbSupported() ? new BrowserTransport(bluetooth, new UsbTransport()) : bluetooth;
}
