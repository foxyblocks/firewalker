/**
 * Shared bottom sheet for connection picking, naming, and one boot's calibration. A native
 * modal dialog keeps focus inside the sheet and makes the app behind it inert.
 * The browser puts it above the page, so it can stay inside the remote's theme.
 * The caller owns whether closing is allowed, so an active capture cannot lose its
 * result through Escape, the backdrop, or either close button.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button, ClearIcon, IconButton } from "./Button";

export function Sheet({ title, children, onClose, closeDisabled = false, closeLabel = "Close" }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  closeLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    // React's input autofocus can run before the dialog is open. Focus
    // the first editable field after opening so Rename is ready for typing.
    element?.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])')?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="sheet-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || closeDisabled) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
    >
      <header className="sheet-header">
        <h2 id={titleId} className="screen-title">{title}</h2>
        <IconButton icon={<ClearIcon />} label={`Close ${title.toLowerCase()}`} disabled={closeDisabled} onClick={onClose} />
      </header>
      <div className="sheet-content">{children}</div>
      <footer className="sheet-footer">
        <Button wide disabled={closeDisabled} onClick={onClose}>{closeLabel}</Button>
      </footer>
    </dialog>
  );
}
