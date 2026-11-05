// A Vite plugin that lets the Send to boot panel see and free a boot's USB port while `bun run dev` runs:
//
//   GET  /api/boot-ports       every program holding a boot's USB port
//   POST /api/boot-ports/free  asks one of our own bench tools to close. Body: {"pid": 1234}
//
// See bootPorts.ts for what it will and won't close.
//
// The dev server only listens on localhost, but a web page in the same browser can still send requests to it.
// So a request has to come from a page on this machine too. Checking the Host header also stops a site that has
// pointed its own domain at this machine. Requiring JSON stops a plain cross-site form.

import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin } from "vite";

import { freePort, FreePortError, listPortHolders } from "./bootPorts.ts";

const PREFIX = "/api/boot-ports";
const MAX_BODY_BYTES = 256;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostName(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : (host.split(":")[0] ?? "");
}

// Whether a request comes from this machine, judging by what the browser can't fake for a page.
export function isLocalRequest(headers: { host?: string; origin?: string }): boolean {
  if (!headers.host || !LOCAL_HOSTS.has(hostName(headers.host))) return false;
  if (!headers.origin) return true;
  try {
    return LOCAL_HOSTS.has(new URL(headers.origin).hostname.replace(/^::1$/, "[::1]"));
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readPid(req: IncomingMessage): Promise<number> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new FreePortError("The request is too large.", 413);
    chunks.push(chunk as Buffer);
  }
  try {
    return (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { pid: number }).pid;
  } catch {
    throw new FreePortError("The body isn't valid JSON.", 400);
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLocalRequest(req.headers)) {
    send(res, 403, { error: "Only pages on this machine can ask about its USB ports." });
    return;
  }
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (req.method === "GET" && path === "/") {
    send(res, 200, { holders: await listPortHolders() });
    return;
  }
  if (req.method === "POST" && path === "/free") {
    if (!req.headers["content-type"]?.startsWith("application/json")) {
      send(res, 415, { freed: false, error: "This needs a JSON body." });
      return;
    }
    send(res, 200, await freePort(await readPid(req)));
    return;
  }
  send(res, 405, { error: "Not supported." });
}

export function bootPortsApi(): Plugin {
  return {
    name: "firewalker-boot-ports-api",
    configureServer(server) {
      server.middlewares.use(PREFIX, (req, res) => {
        handle(req, res).catch((error: unknown) => {
          const status = error instanceof FreePortError ? error.status : 500;
          send(res, status, { freed: false, error: (error as Error).message });
        });
      });
    },
  };
}
