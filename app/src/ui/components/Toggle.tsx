/** A switch, such as the Lights power and the brightness cap. */

export function Toggle({
  on,
  label,
  small,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  /** A compact size that fits beside a readout, as the brightness cap's does. */
  small?: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle${small ? " toggle-small" : ""}${on ? " toggle-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="toggle-knob" />
    </button>
  );
}
