/**
 * A labeled text input with an optional hint or error under it. The label is visible, since a
 * placeholder disappears as soon as you type.
 */

import { useId } from "react";

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  hint?: string;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function TextField({ label, value, onChange, placeholder, maxLength, hint, error, disabled, autoFocus }: TextFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={`field${error ? " field-error" : ""}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {note && (
        <span id={noteId} className="field-note" role={error ? "alert" : undefined}>
          {note}
        </span>
      )}
    </div>
  );
}
