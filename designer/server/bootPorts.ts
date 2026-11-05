// Finds out which program has a boot's USB port open, and closes it if it's one of our own bench tools.
// Only one program can hold a port, and the browser's error doesn't say which, so the dev server asks the
// system with lsof. boot-ports is the Vite plugin in bootPortsApi.ts that serves this to the Send to boot panel.
//
// Closing a process is the one risky thing here, so classifyHolder is a strict allow-list. It reads the full
// command line, because a process's name alone says little: PlatformIO's monitor just shows up as "Python".
// Anything not recognized can't be closed, and freePort checks all of it again against the system at the moment
// of closing, so the client's word for what a pid is doesn't count.

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { promisify } from "node:util";

import type { FreeResult, HolderKind, PortHolder } from "../src/boot/portHolders.ts";

const run = promisify(execFile);
const COMMAND_TIMEOUT_MS = 4000;
// How long a tool gets to close after being asked, and how often to look.
const FREE_WAIT_MS = 3000;
const FREE_CHECK_MS = 150;

export interface OpenPort {
  port: string;
  pid: number;
  process: string;
}

// Reads `lsof -F pcn`, which gives a line per field: `p` starts a process, then `c` is its name, and `n` is an
// open file, with `f` lines between them to ignore. A process with the port open twice counts once.
export function parseLsof(output: string): OpenPort[] {
  const found = new Map<string, OpenPort>();
  let pid = 0;
  let process = "";
  for (const line of output.split("\n")) {
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") {
      pid = Number(value);
      process = "";
    } else if (field === "c") {
      process = value;
    } else if (field === "n" && pid > 0) {
      found.set(`${pid} ${value}`, { port: value, pid, process });
    }
  }
  return [...found.values()];
}

const BROWSERS = /^(Arc|Google Chrome|Chrome|Chromium|Microsoft Edge|Brave Browser|Opera|Vivaldi|Claude)( Helper.*)?$/;

const baseName = (path: string): string => path.split("/").pop() ?? "";

export interface Classified {
  kind: HolderKind;
  name: string;
  canFree: boolean;
}

// Says what a process is. `command` is its full command line from ps. Only our own tools get canFree, and
// each rule looks for that tool's exact shape, so another program with a similar name stays out.
export function classifyHolder(process: string, command: string): Classified {
  if (BROWSERS.test(process)) return { kind: "browser", name: "A browser tab", canFree: false };

  const words = command.trim().split(/\s+/);
  const program = words[0] ?? "";
  const programName = baseName(program);
  const tool = (name: string): Classified => ({ kind: "tool", name, canFree: true });

  // `./cli` runs as `go run`, so the program is a cached binary named cli, given the repo's path.
  if (programName === "cli" && (program.includes("/go-build/") || words.includes("--repo-root"))) return tool("./cli");

  // PlatformIO and miniterm run under Python, so what counts is the script Python was told to run. Only that
  // position counts, so an editor with one of these words in its arguments can't pass as a tool.
  const underPython = /^python[\d.]*$/i.test(programName);
  const asModule = underPython && words[1] === "-m";
  const script = asModule ? words[2] : underPython ? baseName(words[1] ?? "") : programName;
  const args = words.slice(asModule ? 3 : underPython ? 2 : 1);

  if (script === "pio" || script === "platformio") {
    if (args[0] === "device" && args[1] === "monitor") return tool("pio device monitor");
    if (args[0] === "run" && args.includes("upload")) return tool("A PlatformIO upload");
    return { kind: "other", name: "PlatformIO", canFree: false };
  }
  if (script === "miniterm" || script === "miniterm.py" || script === "pyserial-miniterm" || script === "serial.tools.miniterm") {
    return tool("miniterm");
  }

  // The only Python here with pyserial is PlatformIO's own, so a script run with it is a bench script.
  if (underPython && program.includes("/.platformio/penv/bin/")) return tool("A pyserial script");

  return { kind: "other", name: process || programName || "A program", canFree: false };
}

// What this module needs from the system, so tests can stand in for it.
export interface PortSystem {
  listPorts(): Promise<string[]>;
  lsof(ports: string[]): Promise<string>;
  commandOf(pid: number): Promise<string>;
  terminate(pid: number): void;
  sleep(ms: number): Promise<void>;
}

export const realPortSystem: PortSystem = {
  async listPorts() {
    const names = await readdir("/dev").catch(() => [] as string[]);
    return names.filter((name) => name.startsWith("cu.usbmodem")).map((name) => `/dev/${name}`);
  },
  async lsof(ports) {
    try {
      const { stdout } = await run("lsof", ["+c0", "-F", "pcn", "--", ...ports], { timeout: COMMAND_TIMEOUT_MS });
      return stdout;
    } catch (error) {
      // lsof exits with 1 when nothing has these open, which is the good case.
      return (error as { stdout?: string }).stdout ?? "";
    }
  },
  async commandOf(pid) {
    try {
      const { stdout } = await run("ps", ["-o", "command=", "-p", String(pid)], { timeout: COMMAND_TIMEOUT_MS });
      return stdout.trim();
    } catch {
      return "";
    }
  },
  terminate(pid) {
    process.kill(pid, "SIGTERM");
  },
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};

// Everything holding a boot's USB port right now.
export async function listPortHolders(system: PortSystem = realPortSystem): Promise<PortHolder[]> {
  const ports = await system.listPorts();
  if (ports.length === 0) return [];
  const open = parseLsof(await system.lsof(ports));
  return Promise.all(
    open.map(async (entry) => ({ ...entry, ...classifyHolder(entry.process, await system.commandOf(entry.pid)) })),
  );
}

export class FreePortError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Asks one of our own tools to close, and waits for the port to come free. It looks at the system again first,
// and refuses unless this pid holds a boot's port right now and is on the allow-list. It only ever sends SIGTERM,
// which lets a tool put its terminal back, so one that ignores it just stays open.
export async function freePort(pid: number, system: PortSystem = realPortSystem): Promise<FreeResult> {
  if (!Number.isInteger(pid) || pid <= 1) throw new FreePortError("That's not a process id.", 400);

  const holders = (await listPortHolders(system)).filter((holder) => holder.pid === pid);
  if (holders.length === 0) return { freed: true };
  if (!holders.every((holder) => holder.canFree)) {
    throw new FreePortError("Only the bench tools can be closed from here.", 403);
  }

  system.terminate(pid);
  for (let waited = 0; waited < FREE_WAIT_MS; waited += FREE_CHECK_MS) {
    await system.sleep(FREE_CHECK_MS);
    if (!(await listPortHolders(system)).some((holder) => holder.pid === pid)) return { freed: true };
  }
  return { freed: false, error: `${holders[0]!.name} didn't close. Quit it yourself, then connect again.` };
}
