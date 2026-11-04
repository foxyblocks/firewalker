import { commands, LineSplitter, parseLine } from "./protocol";

// These lines are copied from docs/remote-protocol.md on the firmware side, so a
// change there that the app doesn't understand fails here first.
const FIRMWARE_LINES = {
  status:
    '{"t":"status","id":"3ED1","pattern":"flow","brightness":24,"maxBrightness":64,"sensor":"ok","tilt":0.02,"calibrated":true,"neutralDeg":1.56,"calibration":"idle","saved":true,"saveFailed":false,"saves":0,"debug":false,"ble":true}',
  ackOk: '{"t":"ack","cmd":"brightness","ok":true}',
  ackFail: '{"t":"ack","cmd":"brightness","ok":false,"error":"out-of-range"}',
  capturing: '{"t":"calibrate","state":"capturing"}',
  captured: '{"t":"calibrate","state":"ok","neutralDeg":1.56,"tilt":0.00}',
  captureFailed: '{"t":"calibrate","state":"failed","reason":"motion"}',
  motion:
    '{"t":"motion","tilt":0.05,"angleDeg":1.42,"accel":10.18,"gyro":0.03,"stomp":false,"strength":0.00}',
};

describe("parseLine", () => {
  it("reads a status line into the boot's real settings", () => {
    expect(parseLine(FIRMWARE_LINES.status)).toMatchObject({
      t: "status",
      id: "3ED1",
      pattern: "flow",
      brightness: 24,
      maxBrightness: 64,
      sensor: "ok",
      calibrated: true,
      neutralDeg: 1.56,
    });
  });

  it("reads acks, calibration progress, and motion lines", () => {
    expect(parseLine(FIRMWARE_LINES.ackOk)).toEqual({ t: "ack", cmd: "brightness", ok: true });
    expect(parseLine(FIRMWARE_LINES.ackFail)).toMatchObject({ ok: false, error: "out-of-range" });
    expect(parseLine(FIRMWARE_LINES.capturing)).toEqual({ t: "calibrate", state: "capturing" });
    expect(parseLine(FIRMWARE_LINES.captured)).toMatchObject({ state: "ok", neutralDeg: 1.56 });
    expect(parseLine(FIRMWARE_LINES.captureFailed)).toMatchObject({ state: "failed", reason: "motion" });
    expect(parseLine(FIRMWARE_LINES.motion)).toMatchObject({ t: "motion", accel: 10.18, stomp: false });
  });

  it("reads the additions planned for the firmware", () => {
    expect(parseLine('{"t":"patterns","list":["flow","fire-trail"]}')).toEqual({
      t: "patterns",
      list: ["flow", "fire-trail"],
    });
    const withPoses = FIRMWARE_LINES.status.replace(
      '"ble":true',
      '"ble":true,"proto":1,"lit":"fire-trail","heelDeg":-18.4,"toeDeg":null',
    );
    expect(parseLine(withPoses)).toMatchObject({ proto: 1, lit: "fire-trail", heelDeg: -18.4, toeDeg: null });
  });

  it("keeps working when the firmware adds fields it doesn't know yet", () => {
    expect(parseLine('{"t":"ack","cmd":"debug","ok":true,"newField":7}')).toMatchObject({ cmd: "debug" });
  });

  it("ignores anything that isn't a reply it understands", () => {
    expect(parseLine("[firewalker] settings: loaded")).toBeNull();
    expect(parseLine('{"t":"somethingNew"}')).toBeNull();
    expect(parseLine('{"t":"status","id":"3ED1"}')).toBeNull();
    expect(parseLine("")).toBeNull();
    expect(parseLine("[1,2]")).toBeNull();
  });
});

describe("LineSplitter", () => {
  it("joins a reply that spans several notifications", () => {
    const splitter = new LineSplitter();
    expect(splitter.push('{"t":"ack",')).toEqual([]);
    expect(splitter.push('"cmd":"debug",')).toEqual([]);
    expect(splitter.push('"ok":true}\n')).toEqual(['{"t":"ack","cmd":"debug","ok":true}']);
  });

  it("splits several replies that share one notification", () => {
    const splitter = new LineSplitter();
    expect(splitter.push('one\ntwo\nthr')).toEqual(["one", "two"]);
    expect(splitter.push("ee\n")).toEqual(["three"]);
  });

  it("drops a half-received line after a reconnect", () => {
    const splitter = new LineSplitter();
    splitter.push("half a li");
    splitter.reset();
    expect(splitter.push("whole\n")).toEqual(["whole"]);
  });
});

describe("commands", () => {
  it("spells each command the way the firmware parses it", () => {
    expect(commands.status()).toBe("status");
    expect(commands.pattern("fire-trail")).toBe("pattern fire-trail");
    expect(commands.power(true)).toBe("power on");
    expect(commands.power(false)).toBe("power off");
    expect(commands.brightness(32)).toBe("brightness 32");
    expect(commands.debug(true)).toBe("debug on");
    expect(commands.patterns()).toBe("patterns");
    expect(commands.identify()).toBe("identify");
  });

  it("sends plain calibrate for neutral, which every firmware understands", () => {
    expect(commands.calibrate("neutral")).toBe("calibrate");
    expect(commands.calibrate("heel")).toBe("calibrate heel");
    expect(commands.calibrate("toe")).toBe("calibrate toe");
  });

  it("keeps every command inside the 20-byte write the firmware promises", () => {
    for (const line of [commands.pattern("fire-trail"), commands.calibrate("heel"), commands.brightness(255)]) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(20);
    }
  });
});
