// The layer stack, top layer first like an image editor. The recipe stores layers bottom first,
// the order they're drawn in. Drag a layer to move it, or use its arrows from the keyboard.

import { useState, type DragEvent } from "react";

import { LAYER_SPECS, LAYER_TYPES } from "../recipe/spec";
import { MAX_LAYERS, type Layer, type LayerType } from "../recipe/types";

interface LayerListProps {
  layers: Layer[];
  selected: number;
  onSelect: (index: number) => void;
  onAdd: (type: LayerType) => void;
  onToggle: (index: number) => void;
  // Moves the layer at `from` so it ends up at `to`. Both count from the bottom layer.
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}

export function LayerList({ layers, selected, onSelect, onAdd, onToggle, onMove, onRemove }: LayerListProps) {
  const order = layers.map((_, i) => i).reverse();
  const count = layers.length;
  // While dragging: the row being dragged and the gap it would drop into, both counted down
  // the list as shown, where gap 0 is above the top row.
  const [dragging, setDragging] = useState<number | null>(null);
  const [gap, setGap] = useState<number | null>(null);

  const endDrag = () => {
    setDragging(null);
    setGap(null);
  };
  const overRow = (event: DragEvent, row: number) => {
    if (dragging === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const box = event.currentTarget.getBoundingClientRect();
    setGap(event.clientY < box.top + box.height / 2 ? row : row + 1);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    if (dragging !== null && gap !== null) {
      const row = gap > dragging ? gap - 1 : gap;
      const from = count - 1 - dragging;
      const to = count - 1 - row;
      if (from !== to) onMove(from, to);
    }
    endDrag();
  };
  // A gap next to the dragged row wouldn't move it, so it gets no marker.
  const marks = gap !== null && dragging !== null && gap !== dragging && gap !== dragging + 1;

  return (
    <section className="layers">
      <div className="section-head">
        <h3>Layers</h3>
        <span className="quiet small">
          {layers.length} of {MAX_LAYERS}
        </span>
      </div>
      <ol className="layer-list">
        {order.map((i, row) => {
          const layer = layers[i]!;
          const spec = LAYER_SPECS[layer.type];
          const classes = [
            "layer",
            i === selected && "selected",
            row === dragging && "dragging",
            marks && gap === row && "drop-above",
            marks && gap === count && row === count - 1 && "drop-below",
          ];
          return (
            <li
              key={i}
              className={classes.filter(Boolean).join(" ")}
              draggable
              onDragStart={(event) => {
                setDragging(row);
                event.dataTransfer.effectAllowed = "move";
                // Firefox only starts a drag that carries some data.
                event.dataTransfer.setData("text/plain", layer.label || spec.title);
              }}
              onDragOver={(event) => overRow(event, row)}
              onDrop={drop}
              onDragEnd={endDrag}
            >
              <span className="layer-grip" aria-hidden="true" title="Drag to move">
                ⠿
              </span>
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
                <button type="button" title="Move up" aria-label={`Move layer ${i + 1} up`} disabled={i === layers.length - 1} onClick={() => onMove(i, i + 1)}>
                  ↑
                </button>
                <button type="button" title="Move down" aria-label={`Move layer ${i + 1} down`} disabled={i === 0} onClick={() => onMove(i, i - 1)}>
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
