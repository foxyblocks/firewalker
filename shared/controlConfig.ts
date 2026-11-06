/**
 * Repo-wide defaults for the remote and designer. The CLI reads the same JSON from
 * its repo root (internal/controlconfig), so changing a control-surface setting has
 * one source of truth across TypeScript and Go. Firmware knobs belong in config.h.
 */
import config from "../config/control-surfaces.json";

// Browser timers use signed 32-bit delays. Reject invalid edits instead of silently
// turning a very large timeout into an immediate disconnect. Zero disables pausing.
if (!Number.isSafeInteger(config.inactivityTimeoutMs) || config.inactivityTimeoutMs < 0 || config.inactivityTimeoutMs > 2147483647) {
  throw new Error("config/control-surfaces.json: inactivityTimeoutMs must be an integer from 0 to 2147483647");
}

export const inactivityTimeoutMs = config.inactivityTimeoutMs;
