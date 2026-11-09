// Tests the USB transport against a pretend `navigator.serial` whose ports behave the way real
// ones do: a port opens once, reports nothing until asked, and hands back bytes in arbitrary
// chunks. FakeBoot supplies the protocol, with the real BootClient on top where it matters.
import { BootClient } from "../core/boot";
import { FakeBoot } from "./fakeBoot";
import { AccessLostError, type LinkEvents } from "./transport";
import { UsbTransport, usbSupported } from "./usb";

/** A serial port with a boot on the far end. Set `busy` for a port another program holds. */
class FakePort {
  busy = false;
  timesOpened = 0;
  isOpen = false;
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  /** Lines the boot received, including ones that got no answer. */
  readonly received: string[] = [];
  private incoming: ReadableStreamDefaultController<Uint8Array> | null = null;

  constructor(readonly boot: FakeBoot | null) {
    // USB has no subscribe, so a real boot stays quiet until it's asked something.
    if (boot) boot.silentOnSubscribe = true;
  }

  async open(): Promise<void> {
    if (this.isOpen) throw new DOMException("The port is already open.", "InvalidStateError");
    if (this.busy) throw new DOMException("Failed to open serial port.", "NetworkError");
    this.isOpen = true;
    this.timesOpened++;
    this.newReadable();

    let line = "";
    this.writable = new WritableStream<Uint8Array>({
      write: (bytes) => {
        line += new TextDecoder().decode(bytes);
        const lines = line.split("\n");
        line = lines.pop() ?? "";
        for (const received of lines) {
          this.received.push(received);
          this.boot?.receive(received);
        }
      },
    });
    this.boot?.attach({
      onData: (text) => this.send(text),
      onClosed: () => undefined,
    });
  }

  private newReadable(): void {
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.incoming = controller;
      },
    });
  }

  /** Bytes arriving from the boot. */
  send(text: string): void {
    this.incoming?.enqueue(new TextEncoder().encode(text));
  }

  /** A garbled byte: this reader fails, and the port carries on with a new stream. */
  glitch(): void {
    this.incoming?.error(new DOMException("Framing error", "FramingError"));
    this.newReadable();
  }

  /** The cable coming out: reading fails and the streams go away. */
  unplug(): void {
    this.incoming?.error(new DOMException("The device has been lost.", "NetworkError"));
    this.readable = null;
  }

  async close(): Promise<void> {
    if (!this.isOpen) throw new DOMException("The port is already closed.", "InvalidStateError");
    if (this.readable?.locked || this.writable?.locked) throw new TypeError("Cannot close a locked stream");
    this.isOpen = false;
    this.readable = null;
    this.writable = null;
    this.boot?.detach();
  }
}

/** What the browser exposes: `granted` is what this page may use, `chosen` what the picker returns. */
function browserWith(granted: FakePort[], chosen?: FakePort | null) {
  const requestPort = vi.fn(async () => {
    if (!chosen) throw new DOMException("No port selected by the user.", "NotFoundError");
    return chosen as unknown as SerialPort;
  });
  vi.stubGlobal("navigator", {
    serial: { getPorts: async () => granted as unknown as SerialPort[], requestPort },
  });
  return { requestPort };
}

const portFor = (id: string) => new FakePort(new FakeBoot({ id }));
const NO_EVENTS: LinkEvents = { onData: () => undefined, onClosed: () => undefined };
const settle = () => vi.advanceTimersByTimeAsync(400);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("telling whether USB is available", () => {
  it("says yes only in a browser with Web Serial", () => {
    vi.stubGlobal("navigator", {});
    expect(usbSupported()).toBe(false);
    browserWith([]);
    expect(usbSupported()).toBe(true);
  });
});

describe("picking a boot", () => {
  it("only offers boards with the MG24's USB id", async () => {
    const { requestPort } = browserWith([], portFor("3EB5"));
    const picking = new UsbTransport().pick();
    await settle();
    await picking;
    expect(requestPort).toHaveBeenCalledWith({ filters: [{ usbVendorId: 0x2886, usbProductId: 0x0062 }] });
  });

  it("names the boot from what it reports, and lets go of the port", async () => {
    const port = portFor("3EB5");
    browserWith([], port);
    const picking = new UsbTransport().pick();
    await settle();
    await expect(picking).resolves.toEqual({ deviceId: "usb:3EB5", name: "Firewalker-3EB5" });
    expect(port.isOpen).toBe(false);
  });

  it("resolves null when the person cancels", async () => {
    browserWith([], null);
    await expect(new UsbTransport().pick()).resolves.toBeNull();
  });

  it("explains a port that another program has", async () => {
    const port = portFor("3EB5");
    port.busy = true;
    browserWith([], port);
    await expect(new UsbTransport().pick()).rejects.toThrow(/something else is probably using it/i);
  });

  it("explains a board that doesn't speak the protocol, such as one on a bench build", async () => {
    const port = new FakePort(null);
    browserWith([], port);
    const picking = new UsbTransport().pick();
    const failure = expect(picking).rejects.toThrow(/didn't answer/);
    await vi.advanceTimersByTimeAsync(2000);
    await failure;
    expect(port.isOpen).toBe(false);
    expect(port.received.length).toBeGreaterThan(1);
  });

  it("picks a boot that's already connected without opening its port again", async () => {
    const port = portFor("3EB5");
    browserWith([port], port);
    const transport = new UsbTransport();
    const opening = transport.open("usb:3EB5", NO_EVENTS);
    await settle();
    await opening;

    const picking = transport.pick();
    await settle();
    await expect(picking).resolves.toEqual({ deviceId: "usb:3EB5", name: "Firewalker-3EB5" });
    expect(port.isOpen).toBe(true);
  });
});

describe("connecting after a page reload", () => {
  it("finds the right boot among the ports this page may use, and leaves the other alone", async () => {
    const other = portFor("3ED8");
    const wanted = portFor("3EB5");
    browserWith([other, wanted]);
    const opening = new UsbTransport().open("usb:3EB5", NO_EVENTS);
    await settle();
    await opening;
    expect(wanted.isOpen).toBe(true);
    expect(other.isOpen).toBe(false);
  });

  it("connects two boots at once without them colliding on a port", async () => {
    const left = portFor("3EB5");
    const right = portFor("3ED8");
    browserWith([left, right]);
    const transport = new UsbTransport();
    const opening = Promise.all([transport.open("usb:3EB5", NO_EVENTS), transport.open("usb:3ED8", NO_EVENTS)]);
    await settle();
    await opening;
    expect(left.isOpen).toBe(true);
    expect(right.isOpen).toBe(true);
  });

  it("only asks a port who it is once", async () => {
    const other = portFor("3ED8");
    const wanted = portFor("3EB5");
    browserWith([other, wanted]);
    const transport = new UsbTransport();
    const first = transport.open("usb:3EB5", NO_EVENTS);
    await settle();
    await (await first).close();
    const openedBefore = other.timesOpened;

    const second = transport.open("usb:3EB5", NO_EVENTS);
    await settle();
    await second;
    expect(other.timesOpened).toBe(openedBefore);
  });

  it("reports a boot that isn't plugged in as something worth retrying", async () => {
    browserWith([portFor("3ED8")]);
    const opening = new UsbTransport().open("usb:3EB5", NO_EVENTS);
    const failure = expect(opening).rejects.not.toBeInstanceOf(AccessLostError);
    await settle();
    await failure;
  });

  it("still finds a boot when another port can't be asked", async () => {
    const busy = portFor("3ED8");
    busy.busy = true;
    const wanted = portFor("3EB5");
    browserWith([busy, wanted]);
    const opening = new UsbTransport().open("usb:3EB5", NO_EVENTS);
    await settle();
    await opening;
    expect(wanted.isOpen).toBe(true);
  });
});

describe("a connected boot", () => {
  /** A real BootClient connected to a boot on a fake port. */
  const connected = async (id = "3EB5") => {
    const port = portFor(id);
    browserWith([port]);
    const client = new BootClient(new UsbTransport(), `usb:${id}`);
    client.connect();
    await settle();
    return { port, client };
  };

  it("comes online straight away, because connecting asks for status", async () => {
    const { client } = await connected();
    expect(client.getState().link).toBe("online");
    expect(client.getState().status?.id).toBe("3EB5");
    expect(client.getState().patterns).toEqual(["rainbow-pool", "fire-stomp"]);
  });

  it("ends each command with a newline", async () => {
    const { port, client } = await connected();
    client.blink();
    await settle();
    expect(port.received).toContain("identify");
    expect(port.boot?.blinks).toBe(1);
  });

  it("ignores the firmware's log lines between replies", async () => {
    const { port, client } = await connected();
    port.send("[firewalker] settings: 1\n");
    client.setBrightness(30);
    await settle();
    expect(client.getState().status?.brightness).toBe(30);
  });

  it("keeps reading after a garbled byte", async () => {
    const { port, client } = await connected();
    port.glitch();
    await settle();
    client.setBrightness(30);
    await settle();
    expect(client.getState().status?.brightness).toBe(30);
    expect(client.getState().link).toBe("online");
  });

  it("notices the cable coming out, and reconnects when the boot comes back", async () => {
    const { port, client } = await connected();
    port.unplug();
    await settle();
    expect(client.getState().link).toBe("reconnecting");
    expect(port.isOpen).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    expect(client.getState().link).toBe("online");
    expect(port.isOpen).toBe(true);
  });

  it("gives the port back when it disconnects, so another program can use it", async () => {
    const { port, client } = await connected();
    await client.disconnect();
    expect(port.isOpen).toBe(false);
  });

  it("connects once a port another program held comes free", async () => {
    const port = portFor("3EB5");
    port.busy = true;
    browserWith([port]);
    const client = new BootClient(new UsbTransport(), "usb:3EB5");
    client.connect();
    await settle();
    expect(client.getState().link).toBe("reconnecting");

    port.busy = false;
    await vi.advanceTimersByTimeAsync(4000);
    expect(client.getState().link).toBe("online");
  });
});
