// Every setting of the selected layer, generated from its spec in src/recipe/spec.ts.

import { EnumControl, KnobControl, NumberControl, PaletteControl } from "./controls";
import { COMMON_FIELDS, getField, LAYER_SPECS, withField, type Field } from "../recipe/spec";
import { MAX_LABEL_LENGTH, type Color, type Knob, type Layer } from "../recipe/types";

export function Inspector({ layer, onChange }: { layer: Layer; onChange: (layer: Layer) => void }) {
  const spec = LAYER_SPECS[layer.type];
  const set = (key: string, value: unknown) => onChange(withField(layer, key, value));

  return (
    <div className="inspector-body">
      <div className="inspector-title">
        <h3>{spec.title}</h3>
        <p className="quiet small">{spec.summary}</p>
      </div>
      <label className="field">
        <span className="field-label">Label</span>
        <input
          value={layer.label ?? ""}
          placeholder={spec.title}
          maxLength={MAX_LABEL_LENGTH}
          onChange={(event) => {
            const label = event.target.value;
            if (label) {
              onChange({ ...layer, label });
            } else {
              const { label: _dropped, ...rest } = layer;
              onChange(rest as Layer);
            }
          }}
        />
      </label>
      {spec.fields.filter((field) => !field.shownWhen || getField(layer, field.shownWhen.key) === field.shownWhen.value).map((field) => (
        <FieldControl key={field.key} field={field} value={getField(layer, field.key)} onChange={(v) => set(field.key, v)} />
      ))}
      <div className="divider" />
      {COMMON_FIELDS.map((field) => (
        <FieldControl key={field.key} field={field} value={getField(layer, field.key)} onChange={(v) => set(field.key, v)} />
      ))}
    </div>
  );
}

function FieldControl({ field, value, onChange }: { field: Field; value: unknown; onChange: (value: unknown) => void }) {
  switch (field.kind) {
    case "knob":
      return <KnobControl field={field} value={value as Knob} onChange={onChange} />;
    case "number":
      return <NumberControl field={field} value={value as number} onChange={onChange} />;
    case "enum":
      return <EnumControl field={field} value={value as string} onChange={onChange} />;
    case "palette":
      return <PaletteControl field={field} value={value as Color[]} onChange={onChange} />;
  }
}
