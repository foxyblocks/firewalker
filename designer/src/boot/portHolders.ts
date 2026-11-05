// Who has a boot's USB port open, for when Send to boot can't connect. Only one program can hold a port at
// a time, and the browser can't say which one does. The dev server can, so server/bootPorts.ts asks the
// system and this is the panel's side of that: how to ask, and how to say the answer in plain words.
//
// A browser build has no dev server, so there the list just comes back empty, and the panel falls back to
// the connection error it already has.

export type HolderKind = "tool" | "browser" | "other";

export interface PortHolder {
  port: string;
  pid: number;
  // The system's name for the process, such as "Python" or "Arc Helper".
  process: string;
  kind: HolderKind;
  // What to call it, such as "./cli" or "pio device monitor".
  name: string;
  // Whether the panel can offer to close it. Only ever true for our own bench tools.
  canFree: boolean;
}

export interface FreeResult {
  freed: boolean;
  error?: string;
}

export interface BootPortsClient {
  list(): Promise<PortHolder[]>;
  free(pid: number): Promise<FreeResult>;
}

export const devServerPorts: BootPortsClient = {
  async list() {
    const response = await fetch("/api/boot-ports");
    if (!response.ok) return [];
    return ((await response.json()) as { holders: PortHolder[] }).holders;
  },
  async free(pid) {
    const response = await fetch("/api/boot-ports/free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pid }),
    });
    const body = (await response.json().catch(() => ({}))) as Partial<FreeResult>;
    return { freed: body.freed === true, ...(body.error ? { error: body.error } : {}) };
  },
};

// The holder in plain words, for the panel.
export function describeHolder(holder: PortHolder): string {
  if (holder.kind === "browser") return "Another browser tab has this boot open. Close that tab, or disconnect the boot there.";
  if (holder.kind === "tool") return `${holder.name} (pid ${holder.pid}) has this boot open.`;
  return `${holder.name} (pid ${holder.pid}) has this boot open. Quit it to connect here.`;
}
