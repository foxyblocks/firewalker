// Tests BootClient through its interface, against a FakeBoot that speaks the real text
// protocol, so the parsing, queue, and reconnect code all run as they do on a real boot.
import { BootClient, type BootState } from "./boot";
import { FakeBoot, FakeTransport } from "../transport/fakeBoot";

const setup = (options: ConstructorParameters<typeof FakeBoot>[0] = {}) => {
  const boot = new FakeBoot(options);
  const transport = new FakeTransport([boot]);
  const client = new BootClient(transport, boot.deviceId);
  return { boot, transport, client };
};

const state = (client: BootClient): BootState => client.getState();

// Long enough for a command, its ack, and the rate-limited status after it.
const settle = () => vi.advanceTimersByTimeAsync(400);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("connecting", () => {
  it("shows the boot's real settings once connected", async () => {
    const { client } = setup({ pattern: "fire-trail", brightness: 40 });
    client.connect();
    await settle();
    expect(state(client).link).toBe("online");
    expect(state(client).status).toMatchObject({ id: "3ED1", pattern: "fire-trail", brightness: 40 });
  });

  it("asks for status if the boot doesn't send one on subscribe", async () => {
    const { boot, client } = setup();
    boot.silentOnSubscribe = true;
    client.connect();
    await vi.advanceTimersByTimeAsync(1900);
    expect(state(client).status).toBeUndefined();
    await vi.advanceTimersByTimeAsync(300);
    expect(boot.received).toContain("status");
    expect(state(client).link).toBe("online");
  });

  it("keeps asking until a quiet boot answers", async () => {
    const { boot, client } = setup();
    boot.silentOnSubscribe = true;
    boot.unresponsive = true;
    client.connect();
    await vi.advanceTimersByTimeAsync(4500);
    expect(state(client).link).toBe("connecting");

    boot.unresponsive = false;
    await vi.advanceTimersByTimeAsync(2500);
    expect(state(client).link).toBe("online");
  });

  it("starts over on a connection that never says anything", async () => {
    const { boot, transport, client } = setup();
    const open = vi.spyOn(transport, "open");
    boot.silentOnSubscribe = true;
    boot.unresponsive = true;
    client.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(open.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("gets the pattern list right away when status beats the connection finishing", async () => {
    const { transport, client } = setup({ patterns: ["flow", "pattern-3"] });
    transport.openDelayMs = 100;
    client.connect();
    await settle();
    expect(state(client).patterns).toEqual(["flow", "pattern-3"]);
  });

  it("keeps a boot's pattern list if asking again goes unanswered", async () => {
    const { boot, client } = setup({ patterns: ["flow", "pattern-3"] });
    client.connect();
    await settle();

    boot.ignoring = ["patterns"];
    boot.dropLink();
    await vi.advanceTimersByTimeAsync(4000);
    expect(state(client).link).toBe("online");
    expect(state(client).patterns).toEqual(["flow", "pattern-3"]);
  });

  it("asks again if the pattern list never arrived", async () => {
    const { boot, client } = setup({ patterns: ["flow", "pattern-3"] });
    boot.ignoring = ["patterns"];
    client.connect();
    await vi.advanceTimersByTimeAsync(2500);
    expect(state(client).patterns).toEqual([]);

    boot.ignoring = [];
    client.requestStatus();
    await settle();
    expect(state(client).patterns).toEqual(["flow", "pattern-3"]);
  });

  it("uses the pattern list the boot reports", async () => {
    const { client } = setup({ patterns: ["flow", "fire-trail", "pattern-3"] });
    client.connect();
    await settle();
    expect(state(client).patterns).toEqual(["flow", "fire-trail", "pattern-3"]);
  });

  it("turns off debug left on from an earlier session", async () => {
    const { boot, client } = setup({ debug: true });
    client.connect();
    await settle();
    expect(boot.debug).toBe(false);
  });
});

describe("commands", () => {
  it("changes the pattern, showing it as pending until the boot confirms", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();

    client.setPattern("fire-trail");
    expect(state(client).pending.pattern).toBe("fire-trail");
    expect(state(client).status?.pattern).toBe("flow");

    await settle();
    expect(boot.pattern).toBe("fire-trail");
    expect(state(client).status?.pattern).toBe("fire-trail");
    expect(state(client).pending.pattern).toBeUndefined();
  });

  it("sends one command at a time, waiting for each ack", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    boot.received.length = 0;
    boot.replyDelayMs = 100;

    client.setPattern("fire-trail");
    client.setDebug(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(boot.received).toEqual(["pattern fire-trail"]);

    await vi.advanceTimersByTimeAsync(100);
    expect(boot.received).toEqual(["pattern fire-trail", "debug on"]);
  });

  it("says the boot didn't answer and returns to the last reported value", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    boot.unresponsive = true;

    client.setPattern("fire-trail");
    await vi.advanceTimersByTimeAsync(2100);

    expect(state(client).pending.pattern).toBeUndefined();
    expect(state(client).status?.pattern).toBe("flow");
    expect(state(client).notice).toBe("no-answer");
  });

  it("drops the no-answer message once the boot reports again", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    boot.unresponsive = true;
    client.setPattern("fire-trail");
    await vi.advanceTimersByTimeAsync(2100);
    expect(state(client).notice).toBe("no-answer");

    boot.unresponsive = false;
    client.requestStatus();
    await settle();
    expect(state(client).notice).toBeUndefined();
  });

  it("doesn't credit a late ack to the next command", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    boot.received.length = 0;

    boot.replyDelayMs = 2500;
    client.setPattern("fire-trail");
    await vi.advanceTimersByTimeAsync(2100);

    boot.replyDelayMs = 5000;
    client.setDebug(true);
    client.setBrightness(30);
    await vi.advanceTimersByTimeAsync(600);

    expect(boot.received).toEqual(["pattern fire-trail", "debug on"]);
  });

  it("reports a command the boot rejects and drops the pending value", async () => {
    const { client } = setup({ patterns: ["flow"] });
    client.connect();
    await settle();

    client.setPattern("fire-trail");
    await settle();

    expect(state(client).pending.pattern).toBeUndefined();
    expect(state(client).notice).toBe("unknown-pattern");
  });

  it("doesn't send anything while offline", async () => {
    const { boot, client } = setup();
    client.setPattern("fire-trail");
    await settle();
    expect(boot.received).toEqual([]);
    expect(state(client).pending.pattern).toBeUndefined();
  });

  it("turns the lights off and back on through power", async () => {
    const { boot, client } = setup({ pattern: "fire-trail" });
    client.connect();
    await settle();

    client.setPower(false);
    await settle();
    expect(boot.pattern).toBe("off");

    client.setPower(true);
    await settle();
    expect(boot.pattern).toBe("fire-trail");
  });
});

describe("the brightness slider", () => {
  it("sends only the newest value after a burst, as one flash write", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    boot.received.length = 0;
    boot.replyDelayMs = 30;

    client.setDragging(true);
    for (let level = 10; level <= 50; level++) {
      client.setBrightness(level);
      await vi.advanceTimersByTimeAsync(5);
    }
    client.setDragging(false);
    await vi.advanceTimersByTimeAsync(1500);

    expect(boot.brightness).toBe(50);
    expect(boot.received.length).toBeLessThan(15);
    expect(boot.saves).toBe(1);
  });

  it("keeps the thumb where you put it while the boot's echoes arrive", async () => {
    const { client } = setup({ brightness: 10 });
    client.connect();
    await settle();

    client.setDragging(true);
    client.setBrightness(20);
    await settle();
    client.setBrightness(30);
    await vi.advanceTimersByTimeAsync(5);
    expect(state(client).pending.brightness).toBe(30);

    await settle();
    expect(state(client).pending.brightness).toBe(30);

    client.setDragging(false);
    await settle();
    expect(state(client).pending.brightness).toBeUndefined();
    expect(state(client).status?.brightness).toBe(30);
  });
});

describe("calibrating", () => {
  it("captures neutral and reports the angle", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    boot.received.length = 0;

    const result = client.calibrate("neutral");
    expect(state(client).capture).toEqual({ pose: "neutral" });
    await vi.advanceTimersByTimeAsync(2100);

    await expect(result).resolves.toEqual({ ok: true, pose: "neutral", angleDeg: 1.56 });
    expect(boot.received).toContain("calibrate neutral");
    expect(state(client).capture).toBeUndefined();
  });

  it("captures heel and toe on firmware that supports them", async () => {
    const { boot, client } = setup({ calibrated: true, neutralDeg: 1.56 });
    client.connect();
    await settle();

    const heel = client.calibrate("heel");
    await vi.advanceTimersByTimeAsync(2100);
    await expect(heel).resolves.toEqual({ ok: true, pose: "heel", angleDeg: -18.4 });
    expect(boot.heelDeg).toBe(-18.4);

    const toe = client.calibrate("toe");
    await vi.advanceTimersByTimeAsync(2100);
    await expect(toe).resolves.toEqual({ ok: true, pose: "toe", angleDeg: 34.2 });
  });

  it("reports a boot that never settled, keeping the previous calibration", async () => {
    const { boot, client } = setup({ calibrated: true, neutralDeg: 2 });
    client.connect();
    await settle();
    boot.moving = true;

    const result = client.calibrate("neutral");
    await vi.advanceTimersByTimeAsync(2100);

    await expect(result).resolves.toEqual({ ok: false, pose: "neutral", reason: "motion" });
    expect(boot.neutralDeg).toBe(2);
  });

  it("ends the capture when the ack itself reports the failure", async () => {
    const { client } = setup({ sensor: "unavailable" });
    client.connect();
    await settle();

    const result = client.calibrate("neutral");
    await settle();

    await expect(result).resolves.toEqual({ ok: false, pose: "neutral", reason: "sensor-unavailable" });
  });

  it("finds the result in status when no calibrate line arrives", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    boot.moving = true;
    boot.silentCaptureResult = true;

    const result = client.calibrate("neutral");
    await vi.advanceTimersByTimeAsync(4500);

    await expect(result).resolves.toEqual({ ok: false, pose: "neutral", reason: "motion" });
  });

  it("isn't fooled by a status still holding the previous capture's result", async () => {
    const { boot, client } = setup({ calibrated: true, neutralDeg: 1.56 });
    client.connect();
    await settle();
    const heel = client.calibrate("heel");
    await vi.advanceTimersByTimeAsync(2100);
    await heel;
    await settle();

    boot.staleStatusAfterAck = true;
    const finished = vi.fn();
    const toe = client.calibrate("toe");
    void toe.then(finished);
    await vi.advanceTimersByTimeAsync(500);
    expect(finished).not.toHaveBeenCalled();
    expect(state(client).capture).toEqual({ pose: "toe" });

    await vi.advanceTimersByTimeAsync(1700);
    await expect(toe).resolves.toEqual({ ok: true, pose: "toe", angleDeg: 34.2 });
  });

  it("gives up with no-answer if the boot goes quiet mid-capture", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();

    const result = client.calibrate("neutral");
    await vi.advanceTimersByTimeAsync(50);
    boot.unresponsive = true;
    boot.silentCaptureResult = true;
    boot.moving = false;
    // Hold every further reply back, as a stalled radio would.
    boot.replyDelayMs = 60_000;
    await vi.advanceTimersByTimeAsync(8000);

    await expect(result).resolves.toEqual({ ok: false, pose: "neutral", reason: "no-answer" });
  });
});

describe("losing the connection", () => {
  it("reconnects on its own and shows the boot's real state", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();

    boot.dropLink();
    expect(state(client).link).toBe("reconnecting");

    boot.pattern = "fire-trail";
    await vi.advanceTimersByTimeAsync(1500);
    expect(state(client).link).toBe("online");
    expect(state(client).status?.pattern).toBe("fire-trail");
  });

  it("keeps trying, more slowly, while the boot is out of range", async () => {
    const { boot, transport, client } = setup();
    const open = vi.spyOn(transport, "open");
    client.connect();
    await settle();
    open.mockClear();

    boot.reachable = false;
    boot.dropLink();
    await vi.advanceTimersByTimeAsync(4000);
    const earlyAttempts = open.mock.calls.length;
    expect(earlyAttempts).toBeGreaterThanOrEqual(2);
    expect(earlyAttempts).toBeLessThanOrEqual(3);

    boot.reachable = true;
    await vi.advanceTimersByTimeAsync(16_000);
    expect(state(client).link).toBe("online");
  });

  it("doesn't open a second connection when the app returns mid-connect", async () => {
    const { transport, client } = setup();
    const open = vi.spyOn(transport, "open");
    transport.openDelayMs = 500;
    client.connect();
    await vi.advanceTimersByTimeAsync(100);

    client.resume();
    await vi.advanceTimersByTimeAsync(1000);
    expect(open).toHaveBeenCalledTimes(1);
    expect(state(client).link).toBe("online");
  });

  it("still connects when asked again while a cancelled attempt finishes", async () => {
    const { transport, client } = setup();
    transport.openDelayMs = 300;
    client.connect();
    await vi.advanceTimersByTimeAsync(50);
    await client.disconnect();
    client.connect();

    await vi.advanceTimersByTimeAsync(2500);
    expect(state(client).link).toBe("online");
  });

  it("clears anything in flight so nothing fires after the link is back", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    boot.replyDelayMs = 500;
    client.setPattern("fire-trail");
    await vi.advanceTimersByTimeAsync(10);

    boot.dropLink();
    expect(state(client).pending.pattern).toBeUndefined();
  });

  it("stays disconnected when asked to", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    await client.disconnect();
    expect(state(client).link).toBe("idle");
    expect(boot.connected).toBe(false);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(state(client).link).toBe("idle");
  });

  it("re-reads status when the app comes back to the foreground", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    boot.received.length = 0;

    client.resume();
    await settle();
    expect(boot.received).toContain("status");
  });

  it("retries straight away when the app returns while reconnecting", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    boot.reachable = false;
    boot.dropLink();
    await vi.advanceTimersByTimeAsync(100);

    boot.reachable = true;
    client.resume();
    await settle();
    expect(state(client).link).toBe("online");
  });
});

describe("debug and live tilt", () => {
  it("streams motion while debug is on, and stops when it's off", async () => {
    const { client } = setup();
    client.connect();
    await settle();

    client.setDebug(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(state(client).status?.debug).toBe(true);
    expect(state(client).motion).toMatchObject({ t: "motion" });

    client.setDebug(false);
    await settle();
    expect(state(client).status?.debug).toBe(false);
    expect(state(client).motion).toBeUndefined();
  });

  it("includes the peak reading in motion lines", async () => {
    const { client } = setup();
    client.connect();
    await settle();
    client.setDebug(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(state(client).motion?.accelPeak).toBeGreaterThan(0);
  });

  it("polls status for tilt while something is watching, then stops", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    boot.received.length = 0;

    const stop = client.watchTilt(1000);
    await vi.advanceTimersByTimeAsync(3100);
    expect(boot.received.filter((line) => line === "status").length).toBe(3);

    stop();
    boot.received.length = 0;
    await vi.advanceTimersByTimeAsync(3000);
    expect(boot.received).toEqual([]);
  });
});

describe("blinking a boot", () => {
  it("asks the boot to identify itself, leaving its pattern alone", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();

    client.blink();
    await settle();
    expect(boot.blinks).toBe(1);
    expect(boot.pattern).toBe("flow");
  });

});

describe("the strip layout", () => {
  const LAYOUT = { leds: 110, toe: 40, heel: 90 };

  it("shows the layout the boot reports", async () => {
    const { client } = setup(LAYOUT);
    client.connect();
    await settle();
    expect(state(client).status).toMatchObject({ leds: 110, maxLeds: 160, toe: 40, heel: 90 });
  });

  it("sets a value, showing it as pending until the boot confirms", async () => {
    const { boot, client } = setup(LAYOUT);
    client.connect();
    await settle();

    client.setStrip("toe", 45);
    expect(state(client).pending.toe).toBe(45);
    expect(state(client).status?.toe).toBe(40);

    await settle();
    expect(boot.received).toContain("strip toe 45");
    expect(state(client).status?.toe).toBe(45);
    expect(state(client).pending.toe).toBeUndefined();
  });

  it("keeps a whole drag to one queue slot and ends on the last value", async () => {
    const { boot, client } = setup(LAYOUT);
    client.connect();
    await settle();
    boot.received.length = 0;
    boot.replyDelayMs = 100;

    client.setDragging(true);
    for (let leds = 111; leds <= 130; leds++) client.setStrip("leds", leds);
    await settle();
    client.setDragging(false);
    await settle();

    expect(boot.received).toEqual(["strip leds 111", "strip leds 130", "status"]);
    expect(boot.leds).toBe(130);
    expect(state(client).pending.leds).toBeUndefined();
  });

  it("doesn't jump back under the finger while dragging", async () => {
    const { client } = setup(LAYOUT);
    client.connect();
    await settle();

    client.setDragging(true);
    client.setStrip("leds", 130);
    await settle();
    expect(state(client).status?.leds).toBe(130);
    expect(state(client).pending.leds).toBe(130);
  });

  it("saves one flash write for a drag", async () => {
    const { boot, client } = setup(LAYOUT);
    client.connect();
    await settle();

    client.setDragging(true);
    for (let leds = 111; leds <= 120; leds++) {
      client.setStrip("leds", leds);
      await vi.advanceTimersByTimeAsync(50);
    }
    client.setDragging(false);
    await vi.advanceTimersByTimeAsync(1500);

    expect(boot.saves).toBe(1);
    expect(state(client).status?.saved).toBe(true);
  });

  it("reports where cutting the count moved a marker", async () => {
    const { client } = setup({ leds: 160, toe: 52, heel: 132 });
    client.connect();
    await settle();

    client.setStrip("leds", 110);
    await settle();
    expect(state(client).status).toMatchObject({ leds: 110, toe: 52, heel: 109 });
  });

  it("returns to the reported value when the boot rejects one", async () => {
    const { client } = setup(LAYOUT);
    client.connect();
    await settle();

    client.setStrip("toe", 90);
    await settle();
    expect(state(client).pending.toe).toBeUndefined();
    expect(state(client).status?.toe).toBe(40);
    expect(state(client).notice).toBe("same-pixel");
  });
});

describe("the strip preview", () => {
  it("asks the boot to show it", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();

    client.setStripPreview(true);
    await settle();
    expect(boot.preview).toBe(true);
    expect(state(client).status?.preview).toBe(true);
  });

  it("stays up for as long as it's wanted, past the boot's own limit", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();

    client.setStripPreview(true);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(boot.preview).toBe(true);
  });

  it("stops when it's no longer wanted, and stops asking", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();

    client.setStripPreview(true);
    await settle();
    client.setStripPreview(false);
    await settle();
    expect(boot.preview).toBe(false);

    boot.received.length = 0;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(boot.received.filter((line) => line.startsWith("strip"))).toEqual([]);
  });

  it("ends by itself on the boot when the phone goes away", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();

    client.setStripPreview(true);
    await settle();
    boot.dropLink();
    boot.reachable = false;
    await vi.advanceTimersByTimeAsync(61_000);
    expect(boot.preview).toBe(false);
  });

  it("comes back after the connection drops", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();

    client.setStripPreview(true);
    await settle();
    boot.dropLink();
    boot.reachable = false;
    await vi.advanceTimersByTimeAsync(61_000);
    expect(boot.preview).toBe(false);

    boot.reachable = true;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state(client).link).toBe("online");
    expect(boot.preview).toBe(true);
  });

  it("clears one left running by an earlier session", async () => {
    const { boot, client } = setup();
    boot.preview = true;
    client.connect();
    await settle();
    expect(boot.preview).toBe(false);
  });

  it("stops asking once the boot is forgotten", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    client.setStripPreview(true);
    await settle();

    await client.disconnect();
    boot.received.length = 0;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(boot.received).toEqual([]);
  });
});

describe("losing browser access", () => {
  it("says so instead of retrying a connection that can't work", async () => {
    const { boot, client } = setup();
    boot.accessLost = true;
    client.connect();
    await settle();
    expect(state(client).link).toBe("needs-access");

    // Nothing here can fix it, so it stays put even once the boot could be reached.
    boot.accessLost = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state(client).link).toBe("needs-access");
    expect(boot.connected).toBe(false);
  });

  it("keeps retrying an ordinary failure to connect", async () => {
    const { boot, client } = setup();
    boot.reachable = false;
    client.connect();
    await settle();
    expect(state(client).link).toBe("reconnecting");

    boot.reachable = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(state(client).link).toBe("online");
  });
});

describe("microphone tuning", () => {
  it("loads microphone settings on current firmware and skips queries on older boots", async () => {
    const current = setup();
    current.client.connect();
    await settle();
    expect(state(current.client).audio).toMatchObject({ sensitivity: 65, noiseFloor: 8, ready: true });

    const old = setup({ proto: 3 });
    old.client.connect();
    await settle();
    expect(state(old.client).audio).toBeUndefined();
    expect(old.boot.received.some((line) => line.startsWith("audio"))).toBe(false);
  });

  it("coalesces sensitivity drags and settles the last value from the boot", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    client.setDragging(true);
    for (let value = 0; value <= 100; value++) client.setAudioSensitivity(value);
    await settle();
    expect(state(client).pending.audioSensitivity).toBe(100);
    client.setDragging(false);
    await settle();
    expect(boot.audioSensitivity).toBe(100);
    expect(state(client).audio?.sensitivity).toBe(100);
    expect(state(client).pending.audioSensitivity).toBeUndefined();
    expect(boot.received.filter((line) => line.startsWith("audio gain")).length).toBeLessThanOrEqual(2);
  });

  it("finishes quiet calibration and shows its saved result", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    const captured = client.calibrateAudio();
    await settle();
    expect(state(client).audioCalibrating).toBe(true);
    expect(state(client).audio?.calibrating).toBe(true);
    await vi.advanceTimersByTimeAsync(1300);
    expect(await captured).toEqual({ ok: true });
    expect(state(client).audioCalibrating).toBe(false);
    expect(state(client).audio?.noiseFloor).toBe(9);
    await vi.advanceTimersByTimeAsync(1100);
    client.requestAudio();
    await settle();
    expect(state(client).audio?.saved).toBe(true);
    expect(boot.received).toContain("audio calibrate");
  });

  it("settles the audio save indicator after leaving the calibration tab", async () => {
    const { client } = setup();
    client.connect();
    await settle();
    client.setAudioSensitivity(80);
    await settle();
    expect(state(client).audio?.saved).toBe(false);
    await vi.advanceTimersByTimeAsync(1300);
    expect(state(client).audio?.saved).toBe(true);
  });

  it("recovers a lost final audio result by reading the boot's settings", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    boot.silentAudioCaptureResult = true;
    const captured = client.calibrateAudio();
    await vi.advanceTimersByTimeAsync(1800);
    expect(state(client).audioCalibrating).toBe(true);
    await vi.advanceTimersByTimeAsync(2600);
    expect(await captured).toEqual({ ok: true });
    expect(state(client).audio?.noiseFloor).toBe(9);
  });

  it("fails a calibration cleanly when the connection drops", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    const captured = client.calibrateAudio();
    await settle();
    boot.dropLink();
    expect(await captured).toEqual({ ok: false, reason: "offline" });
    expect(state(client).audioCalibrating).toBe(false);
  });

  it("restores the confirmed sensitivity when a command gets no reply", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();
    boot.ignoring = ["audio"];
    client.setAudioSensitivity(90);
    await vi.advanceTimersByTimeAsync(2200);
    expect(state(client).pending.audioSensitivity).toBeUndefined();
    expect(state(client).audio?.sensitivity).toBe(65);
    expect(state(client).notice).toBe("no-answer");
  });
});
