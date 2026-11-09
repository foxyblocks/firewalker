/**
 * A row of equal-width segments with one chosen. As `kind="tabs"` it switches what's shown
 * below it, such as Configuration and Diagnostics. As `kind="choice"` it picks a value, such as
 * which side a boot is on, and reads to screen readers as radio buttons.
 *
 * `size="large"` is the Remote screen's Both, Left, Right row. `size="small"` nests inside a
 * screen. `appearance="joined"` draws one shared track; separate target buttons
 * keep the looser layout used by the main Remote controls.
 */

import type { ReactNode } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Something shown before the label, such as a connection dot. */
  lead?: ReactNode;
  disabled?: boolean;
  /** Dims the label, as for a boot that's offline, while keeping it selectable. */
  dimmed?: boolean;
}

export interface SegmentedProps<T extends string> {
  /** What the row chooses, for screen readers. */
  label: string;
  options: SegmentOption<T>[];
  /** The chosen value. Undefined means none is chosen yet. */
  value: T | undefined;
  onChange: (value: T) => void;
  kind?: "tabs" | "choice";
  size?: "large" | "small";
  /** A single joined track, or separate target buttons. */
  appearance?: "joined" | "separate";
  /** Disables every segment, such as while a capture runs. */
  disabled?: boolean;
  /** Ties tabs to a panel with this id prefix: `${idPrefix}-${value}` panels. */
  idPrefix?: string;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  kind = "tabs",
  size = "small",
  appearance = "separate",
  disabled,
  idPrefix,
}: SegmentedProps<T>) {
  const tabs = kind === "tabs";
  const enabled = options.filter((option) => !option.disabled);
  const focusValue = enabled.some((option) => option.value === value) ? value : enabled[0]?.value;
  return (
    <div className={`tabs${size === "small" ? " tabs-small" : ""}${appearance === "joined" ? " tabs-joined" : ""}`} role={tabs ? "tablist" : "radiogroup"} aria-label={label}>
      {options.map((option) => {
        const chosen = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={tabs ? "tab" : "radio"}
            tabIndex={option.value === focusValue ? 0 : -1}
            aria-selected={tabs ? chosen : undefined}
            aria-checked={tabs ? undefined : chosen}
            aria-controls={tabs && idPrefix ? `${idPrefix}-${option.value}` : undefined}
            className={`tab${chosen ? " tab-on" : ""}${option.dimmed ? " tab-offline" : ""}`}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
              const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
              if (!forward && !backward && event.key !== "Home" && event.key !== "End") return;
              event.preventDefault();
              const current = enabled.findIndex((item) => item.value === option.value);
              const index = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
                : (current + (forward ? 1 : -1) + enabled.length) % enabled.length;
              const next = enabled[index];
              if (!next) return;
              // Keep focus on the selected segment while its panel changes.
              const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button");
              buttons?.[options.findIndex((item) => item.value === next.value)]?.focus();
              onChange(next.value);
            }}
          >
            {option.lead}
            <span className="tab-name">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
