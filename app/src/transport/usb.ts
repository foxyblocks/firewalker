/**
 * Boots plugged into this computer: the Transport seam implemented with Web Serial, which
 * Chromium desktop browsers have and iOS doesn't. `browser.ts` offers this beside Bluetooth.
 * The boot speaks the same text protocol on its USB port as over Bluetooth
 * (docs/remote-protocol.md), so everything above the seam runs unchanged.
 *
 * USB differs from Bluetooth in three ways, and this file is where they get absorbed:
 *
 * - A port doesn't say which boot it is. The browser only reports the USB id, which every
 *   MG24 shares, so the only way to tell two boots apart is to open the port and read `id`
 *   from a status line. A boot's device id is built from that: `usb:3EB5` for Firewalker-3EB5.
 * - A boot says nothing when its port opens, where Bluetooth sends status on subscribe. So
 *   `open` asks for status itself, which brings the boot online without a wait.
 * - One program holds a port at a time. Nothing here keeps a port open unless it's a boot's
 *   live connection, so `./cli` and `pio device monitor` can use any other boot. A port that's
 *   busy simply fails to open, and BootClient retries until it's free.
 *
 * The browser remembers which ports it may use across page reloads, so a saved boot
 * reconnects by itself and this never reports AccessLostError. A boot that's unplugged and
 * one whose access was revoked look the same from here: neither is on the list of ports.
 */

import { BOOT_NAME_PREFIX, commands, LineSplitter, parseLine } from "../core/protocol";
import { usbDeviceId, type BootLink, type FoundBoot, type LinkEvents, type RadioState, type Transport } from "./transport";

/** The XIAO MG24's USB id, so the browser's picker only lists boots. */
const BOOT_USB_ID = { usbVendorId: 0x2886, usbProductId: 0x0062 };
const BAUD_RATE = 115200;
// One status line is about 350 bytes, past Web Serial's default 255-byte buffer.
const READ_BUFFER_BYTES = 4096;
// A running boot answers within about 50 ms. One still starting up misses the first ask.
const IDENTIFY_ASK_EVERY_MS = 500;
const IDENTIFY_TIMEOUT_MS = 2000;

/** What to show someone who picked a boot whose port won't open. */
export const USB_PORT_BUSY_MESSAGE =
  "Couldn't open that boot's USB port. Something else is probably using it, like ./cli or pio device monitor.";

/** True in a browser with Web Serial, which also needs a secure context such as localhost. */
export function usbSupported(): boolean {
  return "serial" in navigator;
}

/** A board that opened but never reported a status line. */
class NoAnswerError extends Error {
  constructor() {
    super("That board didn't answer. It may not be running the Firewalker app.");
    this.name = "NoAnswerError";
  }
}

/**
 * Opens a port and starts reading it, returning a link that writes whole lines. `onClosed`
 * only fires for a port lost from the other end, such as an unplugged cable. Rejects if the
 * port can't open, which usually means another program has it.
 */
async function openPort(port: SerialPort, events: LinkEvents): Promise<BootLink> {
  await port.open({ baudRate: BAUD_RATE, bufferSize: READ_BUFFER_BYTES });

  const writer = port.writable!.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let closing = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const reading = (async () => {
    // A garbled byte fails one reader but leaves the port usable, with a fresh stream in
    // `readable`, so this loops to pick that up. Losing the port leaves `readable` null. The
    // line after a garbled byte may be cut short, which parseLine drops harmlessly.
    while (port.readable && !closing) {
      reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          if (value) events.onData(decoder.decode(value, { stream: true }));
        }
      } catch {
        // Handled by the loop's check on `readable`.
      } finally {
        reader.releaseLock();
        reader = null;
      }
    }
  })();

  const finish = async () => {
    await reading;
    writer.releaseLock();
    await port.close().catch(() => undefined);
  };
  const finished = reading.then(() => {
    if (closing) return;
    closing = true;
    return finish().then(() => events.onClosed());
  });

  return {
    write: (line) => writer.write(encoder.encode(`${line}\n`)),
    close: async () => {
      if (closing) return finished;
      closing = true;
      await reader?.cancel().catch(() => undefined);
      await finish();
    },
  };
}

/**
 * Asks an open port which boot it is, resolving with the `id` from its status line. Log lines
 * and anything else on the port are skipped. Rejects if no status line arrives in time,
 * as with a board running a bench build rather than the app.
 */
async function readBootId(port: SerialPort): Promise<string> {
  const splitter = new LineSplitter();
  let answered: (id: string) => void = () => undefined;
  const answer = new Promise<string>((resolve) => {
    answered = resolve;
  });
  const link = await openPort(port, {
    onData: (text) => {
      for (const line of splitter.push(text)) {
        const reply = parseLine(line);
        if (reply?.t === "status") answered(reply.id);
      }
    },
    onClosed: () => undefined,
  });

  const ask = () => void link.write(commands.status()).catch(() => undefined);
  ask();
  const asking = setInterval(ask, IDENTIFY_ASK_EVERY_MS);
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    giveUp = setTimeout(() => reject(new NoAnswerError()), IDENTIFY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([answer, timedOut]);
  } finally {
    clearInterval(asking);
    clearTimeout(giveUp);
    await link.close();
  }
}

export class UsbTransport implements Transport {
  readonly simulated = false;
  readonly finding = "picker" as const;
  readonly pickers = ["usb"] as const;

  /** Which boot each port turned out to be, so a port is only asked once. */
  private readonly bootIds = new WeakMap<SerialPort, string>();
  private turns: Promise<unknown> = Promise.resolve();

  /**
   * Runs one port operation at a time. Asking a port who it is means opening it, so two boots
   * connecting at startup would otherwise both try to open the same port, and a reconnect
   * could reach a port while its old connection was still closing.
   */
  private inTurn<T>(task: () => Promise<T>): Promise<T> {
    const turn = this.turns.then(task, task);
    this.turns = turn.catch(() => undefined);
    return turn;
  }

  /** Reports "on" when the browser has Web Serial, because USB has no switch to be off. */
  async radioState(): Promise<RadioState> {
    return usbSupported() ? "on" : "unsupported";
  }

  async openSettings(): Promise<void> {}

  /** The browser only offers a picker, so there's nothing to scan. */
  async startScan(): Promise<void> {}

  async stopScan(): Promise<void> {}

  /**
   * Shows the browser's port picker and reads which boot was chosen. Resolves null if the
   * person cancels. Rejects with a message to show them if the port is busy or doesn't answer.
   * The picker needs the tap that called this, so nothing waits ahead of it.
   */
  async pick(): Promise<FoundBoot | null> {
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort({ filters: [BOOT_USB_ID] });
    } catch {
      return null;
    }
    const id = await this.inTurn(async () => {
      try {
        return await this.identify(port);
      } catch (error) {
        if (error instanceof NoAnswerError) throw error;
        throw new Error(USB_PORT_BUSY_MESSAGE);
      }
    });
    return { deviceId: usbDeviceId(id), name: `${BOOT_NAME_PREFIX}${id}` };
  }

  /**
   * Connects to a boot by its USB device id. Rejects if the boot isn't plugged in or its port
   * is busy, and BootClient keeps retrying, so it connects once the port is free.
   */
  open(deviceId: string, events: LinkEvents): Promise<BootLink> {
    return this.inTurn(async () => {
      const port = await this.findPort(deviceId);
      const link = await openPort(port, events);
      // Stands in for the status Bluetooth sends on subscribe. If this write fails, BootClient
      // asks again and eventually drops a link that never answers, so it isn't waited on here.
      void link.write(commands.status()).catch(() => undefined);
      return {
        write: link.write,
        // In turn, so a connection that opens right after this one closes finds the port free.
        close: () => this.inTurn(link.close),
      };
    });
  }

  /** Reads a port's boot id, or returns what it said last time. */
  private async identify(port: SerialPort): Promise<string> {
    const known = this.bootIds.get(port);
    if (known) return known;
    const id = await readBootId(port);
    this.bootIds.set(port, id);
    return id;
  }

  /**
   * Finds the port with this boot on it among the ones the browser lets this page use. Ports
   * that have already said who they are get checked first, so reconnecting to one boot doesn't
   * disturb any other. An unidentified port that can't be asked right now gets skipped, because
   * it might not be the one this is looking for.
   */
  private async findPort(deviceId: string): Promise<SerialPort> {
    const ports = await navigator.serial.getPorts();
    const isThisBoot = (id: string | undefined) => id !== undefined && usbDeviceId(id) === deviceId;
    const known = ports.find((port) => isThisBoot(this.bootIds.get(port)));
    if (known) return known;

    for (const port of ports) {
      if (this.bootIds.has(port)) continue;
      const id = await this.identify(port).catch(() => undefined);
      if (isThisBoot(id)) return port;
    }
    throw new Error(`No USB port found for ${deviceId}`);
  }
}
