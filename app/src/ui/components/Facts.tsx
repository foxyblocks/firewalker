/**
 * A label-and-value table, for what a boot reports. `tight` is the smaller type used for debug
 * numbers. A `quiet` row is secondary detail, such as a saved setting that's rarely the point.
 */

import type { ReactNode } from "react";

export type Tone = "bad" | "warn" | "good";

export function FactTable({ tight, children, label }: { tight?: boolean; children: ReactNode; label?: string }) {
  return (
    <dl className={`facts${tight ? " facts-tight" : ""}`} aria-label={label}>
      {children}
    </dl>
  );
}

export function Fact({ label, value, tone, quiet }: { label: string; value: ReactNode; tone?: Tone; quiet?: boolean }) {
  return (
    <div className={`fact${quiet ? " fact-quiet" : ""}`}>
      <dt>{label}</dt>
      <dd className={tone ? `tone-${tone}` : undefined}>{value}</dd>
    </div>
  );
}
