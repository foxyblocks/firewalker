// A Vite plugin that serves the patterns/ folder to the designer while `bun run dev` runs:
//
//   GET    /api/patterns                       every pattern file, with its version, whether it's
//                                              built in, and any problems
//   PUT    /api/patterns/<name>                save a recipe. Takes `replaces=old` to rename from
//                                              `old`, and `expected=<version>` or `expected=none`
//                                              to fail with a 409 if the file has moved on
//   DELETE /api/patterns/<name>                delete a pattern file
//
// The dev server only listens on localhost, so only this machine can reach it.

import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin } from "vite";

import { deletePattern, listPatterns, PatternStoreError, savePattern } from "./patternStore.ts";

const PREFIX = "/api/patterns";
const MAX_BODY_BYTES = 64 * 1024;

// `shownDir` is how the designer names the folder to people; `dir` is where the files go.
// `builtinsHeader` is the firmware's header to keep in step with built-in recipes, for the repo's own
// folder only.
export function patternsApi(dir: string, shownDir = dir, builtinsHeader?: string): Plugin {
  return {
    name: "firewalker-patterns-api",
    configureServer(server) {
      server.middlewares.use(PREFIX, (req, res) => {
        handle(dir, shownDir, builtinsHeader, req, res).catch((error: unknown) => sendError(res, error));
      });
    },
  };
}

async function handle(dir: string, shownDir: string, builtinsHeader: string | undefined, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

  if (req.method === "GET" && name === "") {
    send(res, 200, { dir: shownDir, patterns: await listPatterns(dir) });
    return;
  }
  if (req.method === "PUT" && name !== "") {
    const expected = url.searchParams.get("expected");
    const saved = await savePattern(
      dir,
      name,
      await readJson(req),
      url.searchParams.get("replaces") ?? undefined,
      expected === null ? undefined : expected === "none" ? null : expected,
      builtinsHeader,
    );
    send(res, 200, { ok: true, ...saved });
    return;
  }
  if (req.method === "DELETE" && name !== "") {
    await deletePattern(dir, name, builtinsHeader);
    send(res, 200, { ok: true });
    return;
  }
  send(res, 405, { ok: false, error: "Not supported." });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new PatternStoreError("The recipe is too large.", 413);
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PatternStoreError("The body isn't valid JSON.", 400);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof PatternStoreError) {
    send(res, error.status, { ok: false, error: error.message, errors: error.errors });
  } else {
    send(res, 500, { ok: false, error: (error as Error).message });
  }
}
