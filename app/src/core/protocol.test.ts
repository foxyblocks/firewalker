import { commands, LineSplitter, parseLine } from "./protocol";

// These lines are copied from docs/remote-protocol.md on the firmware side, so a
// change there that the app doesn't understand fails here first.
const FIRMWARE_LINES = {
  status:
    '{"t":"status","proto":2,"id":"3ED1","pattern":"off","lit":"rainbow-pool","brightness":24,"maxBrightness":96,"capped":true,"capBrightness":96,"sensor":"ok","tilt":0.00,"calibrated":true,"neutralDeg":1.56,"heelDeg":-18.40,"toeDeg":null,"calibration":"idle","saved":true,"saveFailed":false,"saves":0,"debug":false,"ble":true,"leds":110,"maxLeds":160,"toe":40,"heel":90,"preview":false}',
  ackOk: '{"t":"ack","cmd":"brightness","ok":true}',
  ackFail: '{"t":"ack","cmd":"brightness","ok":false,"error":"out-of-range"}',
  patterns: '{"t":"patterns","list":["rainbow-pool","fire-stomp"]}',
  capturing: '{"t":"calibrate","pose":"heel","state":"capturing"}',
  captured: '{"t":"calibrate","pose":"heel","state":"ok","angleDeg":-18.40,"tilt":-1.00}',
  captureFailed: '{"t":"calibrate","pose":"heel","state":"failed","reason":"motion"}',
  motion:
    '{"t":"motion","tilt":0.05,"angleDeg":1.42,"accel":10.18,"accelPeak":10.31,"gyro":0.03,"stomp":false,"strength":0.00}',
};

describe("parseLine", () => {
  it("reads real audio waveform samples and refuses malformed telemetry", () => {
    const sample = { t: "audio", ready: true, level: .4, rms: 18.5, waveform: [0, -.25, .5, 0] };
    expect(parseLine(JSON.stringify(sample))).toEqual(sample);
    expect(parseLine(JSON.stringify({ ...sample, waveform: ["bad"] }))).toBeNull();
    expect(parseLine(JSON.stringify({ ...sample, level: 1.5 }))).toBeNull();
  });

  it("reads the soft cap, and leaves it out for firmware that has none", () => {
    expect(parseLine(FIRMWARE_LINES.status)).toMatchObject({ maxBrightness: 96, capped: true, capBrightness: 96 });
    const beforeTheCap = FIRMWARE_LINES.status.replace('"capped":true,"capBrightness":96,', "");
    expect(parseLine(beforeTheCap)).not.toHaveProperty("capped");
  });

  it("reads a status line into the boot's real settings", () => {
    expect(parseLine(FIRMWARE_LINES.status)).toMatchObject({
      t: "status",
      proto: 2,
      leds: 110,
      maxLeds: 160,
      toe: 40,
      heel: 90,
      preview: false,
      id: "3ED1",
      pattern: "off",
      lit: "rainbow-pool",
      brightness: 24,
      maxBrightness: 96,
      sensor: "ok",
      calibrated: true,
      neutralDeg: 1.56,
      heelDeg: -18.4,
      toeDeg: null,
    });
  });

  it("reads acks, patterns, calibration progress, and motion lines", () => {
    expect(parseLine(FIRMWARE_LINES.ackOk)).toEqual({ t: "ack", cmd: "brightness", ok: true });
    expect(parseLine(FIRMWARE_LINES.ackFail)).toMatchObject({ ok: false, error: "out-of-range" });
    expect(parseLine(FIRMWARE_LINES.patterns)).toEqual({ t: "patterns", list: ["rainbow-pool", "fire-stomp"] });
    expect(parseLine(FIRMWARE_LINES.capturing)).toEqual({ t: "calibrate", pose: "heel", state: "capturing" });
    expect(parseLine(FIRMWARE_LINES.captured)).toMatchObject({ state: "ok", pose: "heel", angleDeg: -18.4 });
    expect(parseLine(FIRMWARE_LINES.captureFailed)).toMatchObject({ state: "failed", reason: "motion" });
    expect(parseLine(FIRMWARE_LINES.motion)).toMatchObject({ t: "motion", accel: 10.18, accelPeak: 10.31 });
  });

  it("reads microphone settings and rejects an incomplete audio reply", () => {
    expect(parseLine('{"t":"audio-config","ready":true,"noiseFloor":9,"sensitivity":65,"calibrating":false,"saved":true}'))
      .toMatchObject({ t: "audio-config", sensitivity: 65, saved: true });
    expect(parseLine('{"t":"audio-config","ready":true}')).toBeNull();
    expect(parseLine('{"t":"audio-config","ready":true,"noiseFloor":9,"sensitivity":101,"calibrating":false,"saved":true}')).toBeNull();
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
    expect(commands.pattern("fire-stomp")).toBe("pattern fire-stomp");
    expect(commands.power(true)).toBe("power on");
    expect(commands.power(false)).toBe("power off");
    expect(commands.cap(true)).toBe("cap on");
    expect(commands.cap(false)).toBe("cap off");
    expect(commands.brightness(32)).toBe("brightness 32");
    expect(commands.debug(true)).toBe("debug on");
    expect(commands.patterns()).toBe("patterns");
    expect(commands.identify()).toBe("identify");
  });

  it("names the pose it's capturing", () => {
    expect(commands.calibrate("neutral")).toBe("calibrate neutral");
    expect(commands.calibrate("heel")).toBe("calibrate heel");
    expect(commands.calibrate("toe")).toBe("calibrate toe");
  });

  it("clears one saved side or explicitly resets all poses", () => {
    expect(commands.clearCalibration("heel")).toBe("calibrate clear heel");
    expect(commands.clearCalibration("toe")).toBe("calibrate clear toe");
    expect(commands.clearCalibration("all")).toBe("calibrate clear all");
  });

  it("names the strip setting it's changing", () => {
    expect(commands.strip("leds", 110)).toBe("strip leds 110");
    expect(commands.strip("toe", 0)).toBe("strip toe 0");
    expect(commands.strip("heel", 90)).toBe("strip heel 90");
    expect(commands.stripPreview(true)).toBe("strip preview on");
    expect(commands.stripPreview(false)).toBe("strip preview off");
  });

  it("keeps every command inside the 20-byte write the firmware promises", () => {
    for (const line of [
      commands.audio(),
      commands.audioGain(100),
      commands.audioCalibrate(),
      commands.pattern("fire-stomp"),
      commands.calibrate("neutral"),
      commands.clearCalibration("heel"),
      commands.brightness(255),
      commands.strip("leds", 160),
      commands.stripPreview(false),
    ]) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(20);
    }
  });
});
