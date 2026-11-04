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

  it("uses the pattern list the boot reports", async () => {
    const { client } = setup({ patterns: ["flow", "fire-trail", "pattern-3"] });
    client.connect();
    await settle();
    expect(state(client).patterns).toEqual(["flow", "fire-trail", "pattern-3"]);
  });

  it("falls back to flow and fire-trail on firmware without the command", async () => {
    const { client } = setup({ firmware: "current" });
    client.connect();
    await settle();
    expect(state(client).patterns).toEqual(["flow", "fire-trail"]);
    expect(state(client).notice).toBeUndefined();
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
    expect(boot.received).toContain("calibrate");
    expect(state(client).capture).toBeUndefined();
  });

  it("captures heel and toe on firmware that supports them", async () => {
    const { boot, client } = setup({ calibrated: true, neutralDeg: 1.56 });
    client.connect();
    await settle();
    expect(state(client).supportsPoses).toBe(true);

    const heel = client.calibrate("heel");
    await vi.advanceTimersByTimeAsync(2100);
    await expect(heel).resolves.toEqual({ ok: true, pose: "heel", angleDeg: -18.4 });
    expect(boot.heelDeg).toBe(-18.4);

    const toe = client.calibrate("toe");
    await vi.advanceTimersByTimeAsync(2100);
    await expect(toe).resolves.toEqual({ ok: true, pose: "toe", angleDeg: 34.2 });
  });

  it("hides heel and toe on firmware without them", async () => {
    const { client } = setup({ firmware: "current" });
    client.connect();
    await settle();
    expect(state(client).supportsPoses).toBe(false);
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
    await vi.advanceTimersByTimeAsync(2500);

    await expect(result).resolves.toEqual({ ok: false, pose: "neutral", reason: "motion" });
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

  it("reports the planned peak reading, and goes without it on current firmware", async () => {
    const planned = setup();
    planned.client.connect();
    await settle();
    planned.client.setDebug(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(state(planned.client).motion?.accelPeak).toBeGreaterThan(0);

    const current = setup({ firmware: "current" });
    current.client.connect();
    await settle();
    current.client.setDebug(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(state(current.client).motion?.accelPeak).toBeUndefined();
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
  it("uses identify on firmware that has it", async () => {
    const { boot, client } = setup();
    client.connect();
    await settle();

    client.blink();
    await settle();
    expect(boot.blinks).toBe(1);
    expect(boot.pattern).toBe("flow");
  });

  it("flips the lights off and back on otherwise, leaving them as they were", async () => {
    const { boot, client } = setup({ firmware: "current" });
    client.connect();
    await settle();
    boot.received.length = 0;

    client.blink();
    await vi.advanceTimersByTimeAsync(1500);
    expect(boot.received).toEqual(["power off", "power on"]);
    expect(boot.pattern).toBe("flow");
  });

  it("flips on and back off when the boot starts off", async () => {
    const { boot, client } = setup({ firmware: "current", pattern: "off" });
    client.connect();
    await settle();
    boot.received.length = 0;

    client.blink();
    await vi.advanceTimersByTimeAsync(1500);
    expect(boot.received).toEqual(["power on", "power off"]);
    expect(boot.pattern).toBe("off");
  });
});

describe("the pattern On will bring back", () => {
  it("comes from the boot when it reports one", async () => {
    const { client } = setup({ pattern: "off", lastLit: "fire-trail" });
    client.connect();
    await settle();
    expect(state(client).litPattern).toBe("fire-trail");
  });

  it("is the last lit pattern the app saw on older firmware", async () => {
    const { client } = setup({ firmware: "current", pattern: "fire-trail" });
    client.connect();
    await settle();
    client.setPower(false);
    await settle();
    expect(state(client).litPattern).toBe("fire-trail");
  });

  it("is unknown when older firmware is off from the start", async () => {
    const { client } = setup({ firmware: "current", pattern: "off" });
    client.connect();
    await settle();
    expect(state(client).litPattern).toBeUndefined();
  });
});
