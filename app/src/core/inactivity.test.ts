// Exercise human activity through the timer's public API. Device traffic never
// enters this API; the integration below keeps polling a real BootClient on a fake
// boot to check that polling cannot hold the connection open.
import { Inactivity } from "../../../shared/inactivity";
import { BootClient } from "./boot";
import { FakeBoot, FakeTransport } from "../transport/fakeBoot";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = (timeoutMs?: number) => {
  const callbacks = { busy: vi.fn(() => false), pause: vi.fn(), wake: vi.fn() };
  const idle = new Inactivity(callbacks, timeoutMs);
  idle.start();
  return { idle, ...callbacks };
};

it("releases after the configured two minutes and stays paused until input", async () => {
  const { idle, pause, wake } = setup();
  await vi.advanceTimersByTimeAsync(119999);
  expect(pause).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(pause).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(120000);
  idle.visibility(false);
  expect(wake).not.toHaveBeenCalled();
  idle.activity();
  expect(wake).toHaveBeenCalledOnce();
  idle.stop();
});

it("measures inactivity from the latest human input", async () => {
  const { idle, pause } = setup(5000);
  await vi.advanceTimersByTimeAsync(4000);
  idle.activity();
  await vi.advanceTimersByTimeAsync(4000);
  expect(pause).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(pause).toHaveBeenCalledOnce();
  idle.stop();
});

it("lets an operation finish without renewing its inactivity allowance", async () => {
  const { idle, busy, pause } = setup(1000);
  busy.mockReturnValue(true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(pause).not.toHaveBeenCalled();
  busy.mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(250);
  expect(pause).toHaveBeenCalledOnce();
  idle.stop();
});

it("releases on backgrounding but never reclaims just because it became visible", () => {
  const { idle, pause, wake } = setup();
  idle.visibility(true);
  expect(pause).toHaveBeenCalledOnce();
  idle.visibility(false);
  expect(wake).not.toHaveBeenCalled();
  idle.stop();
});

it("allows the shared setting to disable idle and background pausing", async () => {
  const { idle, pause } = setup(0);
  idle.visibility(true);
  await vi.advanceTimersByTimeAsync(300000);
  expect(pause).not.toHaveBeenCalled();
  idle.stop();
});

it("releases a polling remote, then reads another client's changes on wake", async () => {
  const boot = new FakeBoot();
  const client = new BootClient(new FakeTransport([boot]), boot.deviceId);
  const idle = new Inactivity({ busy: () => client.busy(), pause: () => client.pause(), wake: () => client.connect() });
  client.connect();
  await vi.advanceTimersByTimeAsync(400);
  const stopPolling = client.watchTilt(1000);
  idle.start();
  await vi.advanceTimersByTimeAsync(120250);
  expect(client.getState().link).toBe("sleeping");
  expect(boot.connected).toBe(false);
  boot.pattern = "fire-trail";
  idle.activity();
  await vi.advanceTimersByTimeAsync(400);
  expect(client.getState().status?.pattern).toBe("fire-trail");
  stopPolling();
  idle.stop();
  await client.disconnect();
});

it("finishes closing before a subscriber immediately wakes the remote", async () => {
  const boot = new FakeBoot();
  const transport = new FakeTransport([boot]);
  const originalOpen = transport.open.bind(transport);
  let release: () => void = () => undefined;
  const closing = new Promise<void>((resolve) => { release = resolve; });
  const open = vi.spyOn(transport, "open").mockImplementationOnce(async (deviceId, events) => {
    const link = await originalOpen(deviceId, events);
    return { ...link, close: async () => { await closing; await link.close(); } };
  });
  const client = new BootClient(transport, boot.deviceId);
  client.connect();
  await vi.advanceTimersByTimeAsync(400);
  const unsubscribe = client.subscribe(() => {
    if (client.getState().link === "sleeping") client.connect();
  });
  client.pause();
  await vi.advanceTimersByTimeAsync(400);
  expect(open).toHaveBeenCalledOnce();
  release();
  await vi.advanceTimersByTimeAsync(400);
  expect(open).toHaveBeenCalledTimes(2);
  expect(client.getState().link).toBe("online");
  unsubscribe();
  await client.disconnect();
});

it("lets microphone calibration finish before releasing an idle connection", async () => {
  const boot = new FakeBoot();
  const client = new BootClient(new FakeTransport([boot]), boot.deviceId);
  client.connect();
  await vi.advanceTimersByTimeAsync(400);
  const captured = client.calibrateAudio();
  const idle = new Inactivity({ busy: () => client.busy(), pause: () => client.pause(), wake: () => client.connect() }, 500);
  idle.start();
  await vi.advanceTimersByTimeAsync(700);
  expect(client.getState().link).toBe("online");
  expect(client.getState().audioCalibrating).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await captured).toEqual({ ok: true });
  expect(client.getState().link).toBe("sleeping");
  idle.stop();
  await client.disconnect();
});
