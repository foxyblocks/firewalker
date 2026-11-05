import { useEffect, useRef, useState, type ReactNode } from "react";

import { MAX_NAME_LENGTH } from "../recipe/types";

function useModal(): React.RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return ref;
}

interface NameDialogProps {
  title: string;
  initial: string;
  confirmLabel: string;
  problem: (name: string) => string | null;
  children?: ReactNode;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

// Asks for a pattern name. The boot shows names in its pattern list, so they're short.
export function NameDialog({ title, initial, confirmLabel, problem, children, onConfirm, onCancel }: NameDialogProps) {
  const ref = useModal();
  const [name, setName] = useState(initial);
  const issue = problem(name);

  return (
    <dialog ref={ref} className="dialog" onCancel={onCancel}>
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!issue) onConfirm(name);
        }}
      >
        <h2>{title}</h2>
        <label className="field">
          <span className="field-label">Name</span>
          <input
            autoFocus
            value={name}
            maxLength={MAX_NAME_LENGTH}
            spellCheck={false}
            onChange={(event) => setName(event.target.value.toLowerCase().replace(/\s+/g, "-"))}
          />
          <span className={issue ? "field-help bad" : "field-help"}>
            {issue ?? `Up to ${MAX_NAME_LENGTH} characters: a-z, 0-9, and hyphens. The boot lists patterns by this name.`}
          </span>
        </label>
        {children}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={Boolean(issue)}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, children, confirmLabel, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  const ref = useModal();
  return (
    <dialog ref={ref} className="dialog" onCancel={onCancel}>
      <h2>{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={danger ? "button danger" : "button primary"} onClick={onConfirm} autoFocus>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
