/**
 * Buttons. `Button` is the big labeled kind: plain, orange primary, a red outline for danger,
 * or "on" for a chosen option. `IconButton` is a 44-pixel tap target around a small glyph,
 * such as the circled X that clears a saved pose.
 *
 * `busy` keeps a button visible and unclickable while its action runs, and says so to screen
 * readers, so a slow boot never looks like a tap that went nowhere.
 */

import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

export type ButtonVariant = "default" | "primary" | "danger" | "on";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  /** Fills its row. */
  wide?: boolean;
  /** The action is running: disabled, with aria-busy. */
  busy?: boolean;
  type?: "button" | "submit";
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "default", wide, busy, disabled, className, type = "button", ...rest }: ButtonProps) {
  const classes = ["button", variant !== "default" && `button-${variant}`, wide && "button-wide", busy && "button-busy", className]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest} />;
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children"> {
  /** What the button does, for screen readers and as its tooltip. */
  label: string;
  icon: ReactNode;
  busy?: boolean;
}

export function IconButton({ label, icon, busy, disabled, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {icon}
    </button>
  );
}

/** A thin circled X. */
export function ClearIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" />
      <path d="m7.5 7.5 5 5m0-5-5 5" strokeLinecap="round" />
    </svg>
  );
}

/** A small chevron, pointing down, that turns up while its panel is open. */
export function ChevronIcon({ open }: { open?: boolean }) {
  return (
    <svg
      className={`chevron${open ? " chevron-open" : ""}`}
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="m2.5 4.5 3.5 3.5 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
