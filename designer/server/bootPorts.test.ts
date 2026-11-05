import { describe, expect, it, vi } from "vitest";

import { classifyHolder, FreePortError, freePort, listPortHolders, parseLsof, type PortSystem } from "./bootPorts";
import { isLocalRequest } from "./bootPortsApi";

const PORT = "/dev/cu.usbmodemFBC116E93";

// Real lines from the Mac these run on.
const PIO_MONITOR =
  "/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python /opt/homebrew/bin/pio device monitor --port /dev/cu.usbmodemFBC116E93 --baud 115200";
const CLI = "/Users/someone/Library/Caches/go-build/d7/d7d6-d/cli --repo-root /Users/someone/code/firewalker";

describe("parseLsof", () => {
  it("reads a process holding a port", () => {
    expect(parseLsof(`p49677\ncPython\nf3\nn${PORT}\n`)).toEqual([{ port: PORT, pid: 49677, process: "Python" }]);
  });

  it("reads several processes and ports", () => {
    const output = `p1\ncArc Helper\nf20\nn/dev/cu.usbmodemA1\np2\ncPython\nf3\nn/dev/cu.usbmodemB1\n`;
    expect(parseLsof(output)).toEqual([
      { port: "/dev/cu.usbmodemA1", pid: 1, process: "Arc Helper" },
      { port: "/dev/cu.usbmodemB1", pid: 2, process: "Python" },
    ]);
  });

  it("counts a process with a port open twice once", () => {
    expect(parseLsof(`p7\nccli\nf3\nn${PORT}\nf4\nn${PORT}\n`)).toHaveLength(1);
  });

  it("reads nothing as nothing", () => {
    expect(parseLsof("")).toEqual([]);
  });
});

describe("classifyHolder", () => {
  it.each([
    ["./cli", "cli", CLI],
    ["pio device monitor", "Python", PIO_MONITOR],
    ["pio device monitor", "python3.14", "python /usr/local/bin/platformio device monitor"],
    ["A PlatformIO upload", "Python", "/opt/python /opt/homebrew/bin/pio run -e final_app -t upload --upload-port FBC116E9"],
    ["miniterm", "Python", "python -m serial.tools.miniterm /dev/cu.usbmodem1 115200"],
    ["miniterm", "Python", "python /usr/local/bin/pyserial-miniterm /dev/cu.usbmodem1"],
    ["A pyserial script", "Python", "/Users/someone/.platformio/penv/bin/python /tmp/peek.py status"],
    ["pio device monitor", "pio", "/Users/someone/.platformio/penv/bin/pio device monitor"],
    ["pio device monitor", "Python", "/Users/someone/.platformio/penv/bin/python /Users/someone/.platformio/penv/bin/pio device monitor"],
    ["pio device monitor", "Python", "python -m platformio device monitor"],
  ])("lets %s be closed", (name, process, command) => {
    expect(classifyHolder(process, command)).toEqual({ kind: "tool", name, canFree: true });
  });

  it.each([
    ["Arc", "/Applications/Arc.app/Contents/MacOS/Arc"],
    ["Arc Helper", "/Applications/Arc.app/Contents/Frameworks/Arc Helper --type=utility"],
    ["Google Chrome Helper", "/Applications/Google Chrome.app/x --type=utility"],
    ["Google Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    ["Chromium", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
    ["Claude Helper", "/Applications/Claude.app/Contents/Frameworks/Claude Helper"],
  ])("calls %s a browser tab, and never closes it", (process, command) => {
    expect(classifyHolder(process, command)).toEqual({ kind: "browser", name: "A browser tab", canFree: false });
  });

  it.each([
    ["an unknown app", "Zoom", "/Applications/zoom.us.app/Contents/MacOS/zoom.us"],
    ["some other program called cli", "cli", "/usr/local/bin/cli serve"],
    ["some other Python script", "Python", "/usr/bin/python3 /tmp/robot.py"],
    ["a plain PlatformIO build", "Python", "/opt/python /opt/homebrew/bin/pio run -e final_app"],
    ["other PlatformIO commands", "Python", "/opt/python /opt/homebrew/bin/pio device list"],
    ["a shell", "zsh", "-zsh"],
    ["a program that only mentions the tools", "vim", "vim pio device monitor miniterm.txt"],
    ["go run itself", "go", "go run . --repo-root /x"],
    ["another Python script mentioning the tools", "Python", "/usr/bin/python3 /tmp/robot.py pio device monitor"],
    ["a program just named after a Python path", "x", "/usr/bin/x /Users/someone/.platformio/penv/bin/python"],
    ["no command line at all", "Python", ""],
  ])("won't close %s", (_, process, command) => {
    expect(classifyHolder(process, command)).toMatchObject({ canFree: false });
  });

  it("names something it doesn't recognize by its process name", () => {
    expect(classifyHolder("Zoom", "/x/zoom.us")).toEqual({ kind: "other", name: "Zoom", canFree: false });
  });
});

// A stand-in for the system: which pids hold the port and what each one is.
function fakeSystem(holders: Record<number, [string, string]>, closesOnTerminate = true) {
  const live = new Map(Object.entries(holders).map(([pid, value]) => [Number(pid), value]));
  const system: PortSystem & { terminate: ReturnType<typeof vi.fn> } = {
    listPorts: async () => [PORT],
    lsof: async () => [...live].map(([pid, [process]]) => `p${pid}\nc${process}\nf3\nn${PORT}\n`).join(""),
    commandOf: async (pid) => live.get(pid)?.[1] ?? "",
    terminate: vi.fn((pid: number) => {
      if (closesOnTerminate) live.delete(pid);
    }),
    sleep: async () => undefined,
  };
  return system;
}

describe("listPortHolders", () => {
  it("says who holds each port, and how to treat them", async () => {
    const holders = await listPortHolders(fakeSystem({ 10: ["Python", PIO_MONITOR], 11: ["Arc Helper", "x"] }));
    expect(holders).toEqual([
      { port: PORT, pid: 10, process: "Python", kind: "tool", name: "pio device monitor", canFree: true },
      { port: PORT, pid: 11, process: "Arc Helper", kind: "browser", name: "A browser tab", canFree: false },
    ]);
  });

  it("has nothing to say with no boot plugged in", async () => {
    const system = fakeSystem({});
    system.listPorts = async () => [];
    system.lsof = vi.fn();
    expect(await listPortHolders(system)).toEqual([]);
    expect(system.lsof).not.toHaveBeenCalled();
  });
});

describe("freePort", () => {
  it("asks one of our tools to close, and waits until the port is free", async () => {
    const system = fakeSystem({ 10: ["Python", PIO_MONITOR] });
    expect(await freePort(10, system)).toEqual({ freed: true });
    expect(system.terminate).toHaveBeenCalledExactlyOnceWith(10);
  });

  it("refuses a browser, whatever the client says it is", async () => {
    const system = fakeSystem({ 11: ["Arc Helper", "x"] });
    await expect(freePort(11, system)).rejects.toMatchObject({ status: 403 });
    expect(system.terminate).not.toHaveBeenCalled();
  });

  it("refuses anything it doesn't recognize", async () => {
    const system = fakeSystem({ 12: ["Zoom", "/x/zoom.us"] });
    await expect(freePort(12, system)).rejects.toBeInstanceOf(FreePortError);
    expect(system.terminate).not.toHaveBeenCalled();
  });

  it("won't touch a process that isn't holding a boot's port, even one of our tools", async () => {
    const system = fakeSystem({ 10: ["Python", PIO_MONITOR] });
    expect(await freePort(999, system)).toEqual({ freed: true });
    expect(system.terminate).not.toHaveBeenCalled();
  });

  it.each([[0], [1], [-5], [1.5], ["10"], [null]])("refuses %s as a process id", async (pid) => {
    const system = fakeSystem({ 10: ["Python", PIO_MONITOR] });
    await expect(freePort(pid as number, system)).rejects.toMatchObject({ status: 400 });
    expect(system.terminate).not.toHaveBeenCalled();
  });

  it("says so if a tool won't close, and doesn't try anything harsher", async () => {
    const system = fakeSystem({ 10: ["Python", PIO_MONITOR] }, false);
    expect(await freePort(10, system)).toEqual({ freed: false, error: "pio device monitor didn't close. Quit it yourself, then connect again." });
    expect(system.terminate).toHaveBeenCalledTimes(1);
  });
});

describe("isLocalRequest", () => {
  it.each([
    [{ host: "localhost:5174" }],
    [{ host: "127.0.0.1:5174" }],
    [{ host: "[::1]:5174" }],
    [{ host: "localhost:5174", origin: "http://localhost:5174" }],
    [{ host: "localhost:5174", origin: "http://127.0.0.1:5174" }],
  ])("allows %j", (headers) => {
    expect(isLocalRequest(headers)).toBe(true);
  });

  it.each([
    [{}],
    [{ host: "evil.example" }],
    [{ host: "evil.example:5174", origin: "http://evil.example:5174" }],
    [{ host: "localhost:5174", origin: "https://evil.example" }],
    [{ host: "localhost:5174", origin: "null" }],
    [{ host: "localhost.evil.example:5174" }],
  ])("refuses %j", (headers) => {
    expect(isLocalRequest(headers as { host?: string; origin?: string })).toBe(false);
  });
});
