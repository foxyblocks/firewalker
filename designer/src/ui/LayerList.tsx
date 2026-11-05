// The layer stack, top layer first like an image editor. The recipe stores layers bottom first,
// the order they're drawn in.

import { LAYER_SPECS, LAYER_TYPES } from "../recipe/spec";
import { MAX_LAYERS, type Layer, type LayerType } from "../recipe/types";

interface LayerListProps {
  layers: Layer[];
  selected: number;
  onSelect: (index: number) => void;
  onAdd: (type: LayerType) => void;
  onToggle: (index: number) => void;
  onMove: (index: number, by: number) => void;
  onRemove: (index: number) => void;
}

export function LayerList({ layers, selected, onSelect, onAdd, onToggle, onMove, onRemove }: LayerListProps) {
  const order = layers.map((_, i) => i).reverse();
  return (
    <section className="layers">
      <div className="section-head">
        <h3>Layers</h3>
        <span className="quiet small">
          {layers.length} of {MAX_LAYERS}
        </span>
      </div>
      <ol className="layer-list">
        {order.map((i) => {
          const layer = layers[i]!;
          const spec = LAYER_SPECS[layer.type];
          return (
            <li key={i} className={i === selected ? "layer selected" : "layer"}>
              <button type="button" className="layer-main" onClick={() => onSelect(i)} aria-current={i === selected}>
                <span className={layer.enabled ? "layer-name" : "layer-name off"}>{layer.label || spec.title}</span>
                <span className="layer-meta">
                  {layer.label ? `${spec.title} · ` : ""}
                  {layer.blend}
                </span>
              </button>
              <div className="layer-tools">
                <button type="button" title={layer.enabled ? "Hide" : "Show"} aria-label={layer.enabled ? `Hide layer ${i + 1}` : `Show layer ${i + 1}`} onClick={() => onToggle(i)}>
                  {layer.enabled ? "◉" : "○"}
                </button>
                <button type="button" title="Move up" aria-label={`Move layer ${i + 1} up`} disabled={i === layers.length - 1} onClick={() => onMove(i, 1)}>
                  ↑
                </button>
                <button type="button" title="Move down" aria-label={`Move layer ${i + 1} down`} disabled={i === 0} onClick={() => onMove(i, -1)}>
                  ↓
                </button>
                <button type="button" title="Remove" aria-label={`Remove layer ${i + 1}`} disabled={layers.length <= 1} onClick={() => onRemove(i)}>
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <label className="field">
        <span className="field-label">Add a layer</span>
        <select
          value=""
          disabled={layers.length >= MAX_LAYERS}
          onChange={(event) => {
            if (event.target.value) onAdd(event.target.value as LayerType);
          }}
        >
          <option value="">{layers.length >= MAX_LAYERS ? `At most ${MAX_LAYERS} layers` : "Choose a type…"}</option>
          {LAYER_TYPES.map((type) => (
            <option key={type} value={type}>
              {LAYER_SPECS[type].title}: {LAYER_SPECS[type].summary}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
