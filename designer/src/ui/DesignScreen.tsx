// Designs one pattern: the layer stack on the left, the simulated boot in the middle, and the
// selected layer's settings on the right. Edits keep as a draft in this browser; Save writes
// patterns/<name>.json.

import { useCallback, useEffect, useRef, useState } from "react";

import { navigate, useLibrary } from "./App";
import { BootPanel } from "./BootPanel";
import { NameDialog } from "./dialogs";
import { Inspector } from "./Inspector";
import { LayerList } from "./LayerList";
import { download } from "./PatternsScreen";
import { SimulatorPanel } from "./SimulatorPanel";
import { MAX_COMPILED_BYTES } from "../recipe/compile";
import { recipeToJson } from "../recipe/serialize";
import { newLayer } from "../recipe/spec";
import { MAX_DESCRIPTION_LENGTH, type Layer, type LayerType, type Recipe } from "../recipe/types";
import { nameProblem } from "../recipe/validate";

// Edits closer together than this undo as one step, so a slider drag is one undo.
const UNDO_MERGE_MS = 600;
const UNDO_LIMIT = 200;

export function DesignScreen({ name }: { name: string }) {
  const [library, state] = useLibrary();
  const entry = state.entries.find((e) => e.name === name);
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<"layer" | "json">("layer");
  const [renaming, setRenaming] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [bootPanelOpen, setBootPanelOpen] = useState(false);
  const history = useRef({ past: [] as Recipe[], future: [] as Recipe[], lastEdit: 0 });
  const [, setHistoryVersion] = useState(0);

  const recipe = entry?.recipe;

  const change = useCallback(
    (next: Recipe) => {
      if (!recipe) return;
      const h = history.current;
      const now = Date.now();
      if (now - h.lastEdit > UNDO_MERGE_MS) {
        h.past.push(recipe);
        if (h.past.length > UNDO_LIMIT) h.past.shift();
      }
      h.lastEdit = now;
      h.future = [];
      setHistoryVersion((v) => v + 1);
      setSaveErrors([]);
      library.update(name, next);
    },
    [library, name, recipe],
  );

  const undo = useCallback(() => {
    const h = history.current;
    const previous = h.past.pop();
    if (!previous || !recipe) return;
    h.future.push(recipe);
    h.lastEdit = 0;
    setHistoryVersion((v) => v + 1);
    library.update(name, previous);
  }, [library, name, recipe]);

  const redo = useCallback(() => {
    const h = history.current;
    const next = h.future.pop();
    if (!next || !recipe) return;
    h.past.push(recipe);
    h.lastEdit = 0;
    setHistoryVersion((v) => v + 1);
    library.update(name, next);
  }, [library, name, recipe]);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveErrors(await library.save(name));
    setSaving(false);
  }, [library, name]);

  const overwrite = useCallback(async () => {
    setSaving(true);
    setSaveErrors(await library.save(name, { overwrite: true }));
    setSaving(false);
  }, [library, name]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void save();
        return;
      }
      if (key !== "z" && key !== "y") return;
      // Text boxes keep their own undo.
      if ((event.target as HTMLElement).closest("input[type=text], textarea, input:not([type])")) return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, redo]);

  if (!entry || !recipe) {
    return (
      <div className="page">
        <header className="topbar">
          <button type="button" className="button" onClick={() => navigate({ screen: "patterns" })}>
            ← Patterns
          </button>
        </header>
        <p className="empty">{state.loading ? "Loading…" : `There's no pattern named "${name}".`}</p>
      </div>
    );
  }

  const layers = recipe.layers;
  const current = Math.min(selected, layers.length - 1);
  const setLayers = (next: Layer[]) => change({ ...recipe, layers: next });
  const statusText =
    entry.status === "saved"
      ? state.storageMode === "browser" ? "Saved in this browser" : `Saved to patterns/${name}.json`
      : entry.status === "changed"
        ? "Unsaved changes, kept in this browser"
        : "Not saved yet, kept in this browser";
  // The conflict banner explains a save that a conflict stopped, so it isn't listed twice.
  const problems = [...new Set([...entry.problems, ...(entry.conflict ? [] : saveErrors)])];
  const conflictFile = `${entry.savedAs ?? name}.json`;

  return (
    <div className="design">
      <header className="topbar">
        <div className="topbar-title">
          <button type="button" className="button" onClick={() => navigate({ screen: "patterns" })}>
            ← Patterns
          </button>
          <h1>{name}</h1>
          <button type="button" className="link" onClick={() => setRenaming(true)}>
            Rename
          </button>
          <span className={`badge ${entry.status}`}>{statusText}</span>
          {entry.builtIn && (
            <span className="badge built-in" title="Listed in patterns/built-ins.txt, so every boot ships with it">
              Built in
            </span>
          )}
          {entry.compiledSize !== null && (
            <span
              className={entry.compiledSize > MAX_COMPILED_BYTES ? "size-meter over" : "size-meter"}
              title="What this recipe takes on a boot, which stores each one in a single flash entry"
            >
              {entry.compiledSize} / {MAX_COMPILED_BYTES} bytes
            </span>
          )}
        </div>
        <div className="topbar-actions">
          <button type="button" className="button" onClick={undo} disabled={history.current.past.length === 0} title="Undo (⌘Z)">
            Undo
          </button>
          <button type="button" className="button" onClick={redo} disabled={history.current.future.length === 0} title="Redo (⇧⌘Z)">
            Redo
          </button>
          <button type="button" className="button" onClick={() => download(recipe)}>
            Download
          </button>
          <button type="button" className={bootPanelOpen ? "button on" : "button"} aria-expanded={bootPanelOpen} onClick={() => setBootPanelOpen(!bootPanelOpen)}>
            Send to boot
          </button>
          {entry.status === "changed" && (
            <button
              type="button"
              className="button"
              onClick={() => {
                library.discard(name);
                if (entry.savedAs && entry.savedAs !== name) navigate({ screen: "design", name: entry.savedAs });
              }}
            >
              Discard changes
            </button>
          )}
          <button
            type="button"
            className="button primary"
            onClick={() => void save()}
            disabled={saving || entry.status === "saved" || entry.problems.length > 0 || state.storageMode === "unavailable" || entry.conflict !== null}
            title={
              state.storageMode === "browser"
                ? "Save in this browser (⌘S)"
              : !state.repoAvailable
                ? "Needs the designer's dev server"
                : entry.conflict
                  ? "The file changed on disk. Choose what to do in the message below."
                  : "Save to the repo (⌘S)"
            }
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {bootPanelOpen && <BootPanel recipe={recipe} canSend={entry.problems.length === 0} onClose={() => setBootPanelOpen(false)} />}

      {problems.length > 0 && (
        <div className="banner bad">
          <strong>Can't save yet:</strong>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {entry.conflict && (
        <div className="banner bad" role="alert">
          {entry.conflict === "changed" ? (
            <p>
              <strong>{conflictFile} changed on disk</strong> after this draft started, maybe from a git pull. Saving would
              overwrite that change.
            </p>
          ) : (
            <p>
              <strong>{conflictFile} was deleted on disk</strong> after this draft started, maybe by a git pull. Saving would
              bring it back.
            </p>
          )}
          <div className="banner-actions">
            <button type="button" className="button small" disabled={saving} onClick={() => void overwrite()}>
              {entry.conflict === "changed" ? "Overwrite with my draft" : "Save my draft anyway"}
            </button>
            <button
              type="button"
              className="button small"
              onClick={() => {
                library.discard(name);
                if (entry.conflict === "deleted") navigate({ screen: "patterns" });
                else if (entry.savedAs && entry.savedAs !== name) navigate({ screen: "design", name: entry.savedAs });
              }}
            >
              {entry.conflict === "changed" ? "Use the file, drop my draft" : "Drop my draft"}
            </button>
            <button type="button" className="button small" onClick={() => download(recipe)}>
              Download my draft
            </button>
          </div>
        </div>
      )}

      <div className="design-grid">
        <aside className="panel">
          <label className="field">
            <span className="field-label">Description</span>
            <textarea
              rows={3}
              maxLength={MAX_DESCRIPTION_LENGTH}
              placeholder="What this pattern does, for people. The boot never sees it."
              value={recipe.description}
              onChange={(event) => change({ ...recipe, description: event.target.value })}
            />
          </label>
          <LayerList
            layers={layers}
            selected={current}
            onSelect={(i) => {
              setSelected(i);
              setTab("layer");
            }}
            onAdd={(type: LayerType) => {
              setLayers([...layers, newLayer(type)]);
              setSelected(layers.length);
              setTab("layer");
            }}
            onToggle={(i) => setLayers(layers.map((l, k) => (k === i ? { ...l, enabled: !l.enabled } : l)))}
            onMove={(from, to) => {
              const next = [...layers];
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved!);
              setLayers(next);
              // The selection stays on the same layer wherever it ends up.
              setSelected(next.indexOf(layers[current]!));
            }}
            onRemove={(i) => {
              setLayers(layers.filter((_, k) => k !== i));
              if (current >= i && current > 0) setSelected(current - 1);
            }}
          />
        </aside>

        <main className="panel center">
          <SimulatorPanel recipe={recipe} />
        </main>

        <aside className="panel">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "layer"} className={tab === "layer" ? "on" : ""} onClick={() => setTab("layer")}>
              Layer
            </button>
            <button type="button" role="tab" aria-selected={tab === "json"} className={tab === "json" ? "on" : ""} onClick={() => setTab("json")}>
              JSON
            </button>
          </div>
          {tab === "layer" && layers[current] ? (
            <Inspector layer={layers[current]} onChange={(layer) => setLayers(layers.map((l, k) => (k === current ? layer : l)))} />
          ) : (
            <JsonView recipe={recipe} />
          )}
        </aside>
      </div>

      {renaming && (
        <NameDialog
          title={`Rename ${name}`}
          initial={name}
          confirmLabel="Rename"
          problem={(next) =>
            nameProblem(next) ?? (next !== name && next !== entry.savedAs && library.isTaken(next) ? `"${next}" is taken.` : null)
          }
          onConfirm={(next) => {
            setRenaming(false);
            const problem = library.rename(name, next);
            if (problem) setSaveErrors([problem]);
            else navigate({ screen: "design", name: next });
          }}
          onCancel={() => setRenaming(false)}
        >
          {entry.savedAs && <p className="field-help">The file is renamed when you save.</p>}
        </NameDialog>
      )}
    </div>
  );
}

function JsonView({ recipe }: { recipe: Recipe }) {
  const json = recipeToJson(recipe);
  const [copied, setCopied] = useState(false);
  return (
    <div className="json">
      <div className="section-head">
        <span className="quiet small">{new TextEncoder().encode(json).length} bytes as JSON</span>
        <button
          type="button"
          className="button small"
          onClick={() => {
            void navigator.clipboard?.writeText(json).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{json}</pre>
    </div>
  );
}
