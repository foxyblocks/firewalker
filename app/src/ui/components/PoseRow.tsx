/**
 * One calibrated pose in a list: its name, where it stands, and its saved angle as quiet
 * metadata. Tapping the row picks it to capture or retake. A saved row has a small circled X
 * inside its right edge that clears it. The clear button and the row's own button are
 * siblings, so clearing never also picks the pose.
 */

import type { ReactNode } from "react";
import { ClearIcon, IconButton } from "./Button";

/**
 * - unset: nothing saved on the boot.
 * - saved: the boot has one from before.
 * - done: captured just now.
 * - capturing: the boot is collecting it.
 * - failed: the last capture didn't take; `failure` says why.
 */
export type PoseStatus = "unset" | "saved" | "done" | "capturing" | "failed";

export interface PoseRowProps {
  name: string;
  status: PoseStatus;
  /** The angle the boot saved, shown small beside the status. */
  degrees?: number;
  /** The row the next capture is for. */
  active?: boolean;
  /** Why the last capture failed. */
  failure?: string;
  /** Holds the row still, such as while another pose is capturing. */
  disabled?: boolean;
  onSelect: () => void;
  /** Shows the clear button. Leave out when there's nothing saved to clear. */
  onClear?: () => void;
  clearLabel?: string;
  clearDisabled?: boolean;
  /** A clear is on its way to the boot. */
  clearing?: boolean;
}

const SUMMARY: Record<Exclude<PoseStatus, "unset">, string> = {
  saved: "Saved",
  done: "Done",
  capturing: "Stay there",
  failed: "Try again",
};

export function PoseRow({
  name,
  status,
  degrees,
  active,
  failure,
  disabled,
  onSelect,
  onClear,
  clearLabel,
  clearDisabled,
  clearing,
}: PoseRowProps) {
  const summary = status === "unset" ? (active ? "Now" : "Not set") : SUMMARY[status];
  const tone =
    status === "failed" ? " step-bad" : status === "done" || status === "saved" ? " step-good" : status === "capturing" || active ? " step-active" : "";
  const showDegrees = degrees !== undefined && (status === "saved" || status === "done");

  return (
    <li className={`step${tone}${onClear ? " step-with-clear" : ""}`}>
      <button type="button" className="step-select" disabled={disabled} aria-current={active || undefined} onClick={onSelect}>
        <span className="step-line">
          <span className="card-name">{name}</span>
          <span className="pose-state">
            {showDegrees && <span className="pose-degrees">{degrees.toFixed(1)}°</span>}
            <span className="pose-summary">{summary}</span>
          </span>
        </span>
        {failure && <span className="step-failure">{failure}</span>}
      </button>
      {onClear && (
        <IconButton
          className="step-clear"
          label={clearLabel ?? `Clear ${name.toLowerCase()}`}
          icon={<ClearIcon />}
          disabled={clearDisabled}
          busy={clearing}
          onClick={onClear}
        />
      )}
    </li>
  );
}

export function PoseList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ol className="steps" aria-label={label}>
      {children}
    </ol>
  );
}
