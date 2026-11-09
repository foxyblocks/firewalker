/**
 * A short message inside a screen: plain help, or a warning or failure with a colored edge.
 * Failures are announced to screen readers as alerts, everything else as status.
 */

import type { ReactNode } from "react";

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "bad"; children: ReactNode }) {
  return (
    <p className={`notice notice-${tone}`} role={tone === "bad" ? "alert" : "status"}>
      {children}
    </p>
  );
}
