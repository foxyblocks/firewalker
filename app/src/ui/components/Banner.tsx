/**
 * A line across the top of a screen about the boots as a whole: a failed save, a dropped
 * link, firmware that needs an update. Warn is for something in progress or waiting on you,
 * bad for something that failed. An action, such as Reconnect, sits at its right end.
 * A Notice is the smaller cousin, for help inside one section.
 */

import type { ReactNode } from "react";

export interface BannerProps {
  tone: "warn" | "bad";
  children: ReactNode;
  /** One button at the banner's end, for the step that fixes it. */
  action?: { label: string; onClick: () => void };
}

export function Banner({ tone, children, action }: BannerProps) {
  if (!action) {
    return (
      <p className={`banner banner-${tone}`} role="status">
        {children}
      </p>
    );
  }
  return (
    <div className={`banner banner-${tone} banner-action`} role="status">
      <span>{children}</span>
      <button type="button" className="button" onClick={action.onClick}>
        {action.label}
      </button>
    </div>
  );
}
