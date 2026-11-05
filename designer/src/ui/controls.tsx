// Inspector controls for one layer field each: knobs that can follow a source, plain numbers,
// choices, and palettes.

import { useEffect, useState } from "react";

import {
  PALETTE_PRESETS,
  SOURCE_HELP,
  SOURCE_LABELS,
  STOMP_FADE,
  WAVE_PERIOD,
  type EnumField,
  type KnobField,
  type NumberField,
  type PaletteField,
} from "../recipe/spec";
import { isBinding, MAX_PALETTE_STOPS, SOURCES, type Binding, type Color, type Knob, type Source } from "../recipe/types";

// A slider with a number box beside it. The box takes free typing and commits a clamped value.
export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  integer?: boolean;
  onChange: (value: number) => void;
}) {
  const { label, value, min, max, step, unit, integer, onChange } = props;
  const [text, setText] = useState(format(value, step));
  useEffect(() => setText(format(value, step)), [value, step]);

  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(parsed)) {
      setText(format(value, step));
      return;
    }
    const clamped = Math.min(max, Math.max(min, integer ? Math.round(parsed) : parsed));
    onChange(clamped);
    setText(format(clamped, step));
  };

  return (
    <div className="slider">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <input
        type="text"
        inputMode="decimal"
        className="num"
        aria-label={`${label} value`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit((event.target as HTMLInputElement).value);
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}

function format(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return String(Number(value.toFixed(decimals)));
}

export function FieldShell(props: { label: string; help?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="field">
      <div className="field-head">
        <span className="field-label">{props.label}</span>
        {props.aside}
      </div>
      {props.children}
      {props.help && <p className="field-help">{props.help}</p>}
    </div>
  );
}

export function NumberControl({ field, value, onChange }: { field: NumberField; value: number; onChange: (v: number) => void }) {
  return (
    <FieldShell label={field.label} help={field.help}>
      <Slider
        label={field.label}
        value={value}
        min={field.min}
        max={field.max}
        step={field.step}
        unit={field.unit}
        integer={field.integer}
        onChange={onChange}
      />
    </FieldShell>
  );
}

export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === props.value}
          className={option.value === props.value ? "on" : ""}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function EnumControl({ field, value, onChange }: { field: EnumField; value: string; onChange: (v: string) => void }) {
  return (
    <FieldShell label={field.label} help={field.help}>
      <Segmented label={field.label} value={value} options={field.options} onChange={onChange} />
    </FieldShell>
  );
}

// A knob is either fixed or follows a source between a min and a max.
export function KnobControl({ field, value, onChange }: { field: KnobField; value: Knob; onChange: (v: Knob) => void }) {
  const bound = isBinding(value);
  const fixedValue = bound ? value.max : value;

  const toggle = (mode: "fixed" | "follows") => {
    if (mode === "fixed" && bound) onChange(value.max);
    if (mode === "follows" && !bound) {
      onChange({ source: "tilt", min: field.min < 0 ? 0 : field.min, max: value === field.min ? field.max : value });
    }
  };

  return (
    <FieldShell
      label={field.label}
      help={bound ? SOURCE_HELP[value.source] : field.help}
      aside={
        <Segmented
          label={`${field.label} mode`}
          value={bound ? "follows" : "fixed"}
          options={[
            { value: "fixed", label: "Fixed" },
            { value: "follows", label: "Follows" },
          ]}
          onChange={toggle}
        />
      }
    >
      {bound ? (
        <BindingEditor field={field} binding={value} onChange={onChange} />
      ) : (
        <Slider label={field.label} value={fixedValue} min={field.min} max={field.max} step={field.step} unit={field.unit} onChange={onChange} />
      )}
    </FieldShell>
  );
}

function BindingEditor({ field, binding, onChange }: { field: KnobField; binding: Binding; onChange: (v: Binding) => void }) {
  const setSource = (source: Source) => {
    const next: Binding = { source, min: binding.min, max: binding.max };
    if (source === "wave") next.periodMs = WAVE_PERIOD.default;
    if (source === "stompFade") next.fadeMs = STOMP_FADE.default;
    onChange(next);
  };

  return (
    <div className="binding">
      <select aria-label={`${field.label} source`} value={binding.source} onChange={(event) => setSource(event.target.value as Source)}>
        {SOURCES.map((source) => (
          <option key={source} value={source}>
            {SOURCE_LABELS[source]}
          </option>
        ))}
      </select>
      <div className="binding-row">
        <span className="binding-end">Min</span>
        <Slider label={`${field.label} min`} value={binding.min} min={field.min} max={field.max} step={field.step} unit={field.unit} onChange={(min) => onChange({ ...binding, min })} />
      </div>
      <div className="binding-row">
        <span className="binding-end">Max</span>
        <Slider label={`${field.label} max`} value={binding.max} min={field.min} max={field.max} step={field.step} unit={field.unit} onChange={(max) => onChange({ ...binding, max })} />
      </div>
      {binding.source === "wave" && (
        <div className="binding-row">
          <span className="binding-end">Period</span>
          <Slider
            label={`${field.label} period`}
            value={binding.periodMs ?? WAVE_PERIOD.default}
            min={WAVE_PERIOD.min}
            max={WAVE_PERIOD.max}
            step={50}
            unit="ms"
            integer
            onChange={(periodMs) => onChange({ ...binding, periodMs })}
          />
        </div>
      )}
      {binding.source === "stompFade" && (
        <div className="binding-row">
          <span className="binding-end">Fade</span>
          <Slider
            label={`${field.label} fade`}
            value={binding.fadeMs ?? STOMP_FADE.default}
            min={STOMP_FADE.min}
            max={STOMP_FADE.max}
            step={10}
            unit="ms"
            integer
            onChange={(fadeMs) => onChange({ ...binding, fadeMs })}
          />
        </div>
      )}
    </div>
  );
}

export function PaletteControl({ field, value, onChange }: { field: PaletteField; value: Color[]; onChange: (v: Color[]) => void }) {
  const set = (i: number, color: Color) => onChange(value.map((c, k) => (k === i ? color.toLowerCase() : c)));
  const remove = (i: number) => onChange(value.filter((_, k) => k !== i));
  const move = (i: number, by: number) => {
    const next = [...value];
    const [color] = next.splice(i, 1);
    next.splice(i + by, 0, color!);
    onChange(next);
  };

  return (
    <FieldShell
      label={field.label}
      aside={
        <select
          className="small-select"
          aria-label="Load a palette preset"
          value=""
          onChange={(event) => {
            const preset = PALETTE_PRESETS.find((p) => p.name === event.target.value);
            if (preset) onChange([...preset.colors]);
          }}
        >
          <option value="">Presets…</option>
          {PALETTE_PRESETS.map((preset) => (
            <option key={preset.name} value={preset.name}>
              {preset.name}
            </option>
          ))}
        </select>
      }
    >
      <div className="palette-strip" style={{ background: gradient(value) }} aria-hidden="true" />
      <ol className="palette">
        {value.map((color, i) => (
          <li key={i} className="stop">
            <label className="swatch" style={{ background: color }}>
              <input type="color" aria-label={`Color ${i + 1}`} value={color} onChange={(event) => set(i, event.target.value)} />
            </label>
            <div className="stop-actions">
              <button type="button" aria-label={`Move color ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                ‹
              </button>
              <button type="button" aria-label={`Remove color ${i + 1}`} disabled={value.length <= 1} onClick={() => remove(i)}>
                ×
              </button>
              <button type="button" aria-label={`Move color ${i + 1} later`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                ›
              </button>
            </div>
          </li>
        ))}
        {value.length < MAX_PALETTE_STOPS && (
          <li>
            <button type="button" className="swatch add" aria-label="Add a color" onClick={() => onChange([...value, value[value.length - 1] ?? "#ffffff"])}>
              +
            </button>
          </li>
        )}
      </ol>
    </FieldShell>
  );
}

function gradient(colors: Color[]): string {
  if (colors.length === 1) return colors[0]!;
  return `linear-gradient(90deg, ${colors.join(", ")})`;
}
