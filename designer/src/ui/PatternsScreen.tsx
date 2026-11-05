// The pattern list: every recipe in the repo's patterns/ folder plus this browser's drafts,
// with create, open, duplicate, rename, download, import, and delete.

import { useRef, useState } from "react";

import { navigate, useLibrary } from "./App";
import { ConfirmDialog, NameDialog } from "./dialogs";
import { Thumbnail } from "./Thumbnail";
import { recipeToJson } from "../recipe/serialize";
import { LAYER_SPECS, newLayer, withDefaults } from "../recipe/spec";
import { RECIPE_FORMAT, RECIPE_VERSION, type Recipe } from "../recipe/types";
import { nameProblem, validateRecipe } from "../recipe/validate";
import type { PatternEntry, PatternStatus } from "../store/patterns";

type Dialog =
  | { kind: "new" }
  | { kind: "rename"; entry: PatternEntry }
  | { kind: "delete"; entry: PatternEntry }
  | null;

const STATUS_TEXT: Record<PatternStatus, string> = {
  saved: "Saved",
  changed: "Unsaved changes",
  new: "Not saved yet",
};

const BLANK = "";

export function PatternsScreen() {
  const [library, state] = useLibrary();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [startFrom, setStartFrom] = useState(BLANK);
  const [notice, setNotice] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  // A rename may return to the file the pattern came from.
  const freeName = (name: string, entry?: PatternEntry) =>
    nameProblem(name) ??
    (name !== entry?.name && name !== entry?.savedAs && library.isTaken(name) ? `"${name}" is taken.` : null);

  const create = (name: string) => {
    const source = startFrom === BLANK ? null : library.entry(startFrom);
    const recipe: Recipe = source
      ? { ...structuredClone(source.recipe), name }
      : { format: RECIPE_FORMAT, version: RECIPE_VERSION, name, description: "", layers: [newLayer("fill")] };
    const created = library.create(recipe);
    setDialog(null);
    navigate({ screen: "design", name: created });
  };

  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    const messages: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const result = validateRecipe(withDefaults(JSON.parse(await file.text())));
        if (!result.ok) {
          messages.push(`${file.name}: ${result.errors[0]}`);
          continue;
        }
        const name = library.create(result.recipe);
        messages.push(name === result.recipe.name ? `Imported ${name}.` : `Imported ${file.name} as ${name}.`);
      } catch {
        messages.push(`${file.name}: not valid JSON.`);
      }
    }
    setNotice(messages.join(" "));
    if (importRef.current) importRef.current.value = "";
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar-title">
          <h1>Patterns</h1>
          <span className="quiet">
            {state.loading
              ? "Loading the repo's patterns…"
              : state.repoAvailable
                ? `Saved to ${state.repoDir ?? "patterns/"}`
                : "Drafts only: the repo isn't reachable"}
          </span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="button" onClick={() => importRef.current?.click()}>
            Import
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            multiple
            hidden
            onChange={(event) => void importFiles(event.target.files)}
          />
          <button type="button" className="button primary" onClick={() => setDialog({ kind: "new" })}>
            New pattern
          </button>
        </div>
      </header>

      {!state.loading && !state.repoAvailable && (
        <p className="banner">
          The designer couldn't reach its dev server, so Save and Delete are off. Edits still keep as drafts in this
          browser. Run <code>bun run dev</code> in <code>designer/</code> to save to the repo.
        </p>
      )}
      {state.broken.map((file) => (
        <p key={file.name} className="banner bad">
          <strong>patterns/{file.name}.json</strong> can't be opened: {file.errors.join(" ")}
        </p>
      ))}
      {notice && (
        <p className="banner" role="status">
          {notice}{" "}
          <button type="button" className="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}

      {state.entries.length === 0 && !state.loading ? (
        <div className="empty">
          <p>No patterns yet.</p>
          <button type="button" className="button primary" onClick={() => setDialog({ kind: "new" })}>
            New pattern
          </button>
        </div>
      ) : (
        <ul className="cards">
          {state.entries.map((entry) => (
            <li
              key={entry.name}
              className="card"
              // The whole card opens the pattern, except its own buttons. The thumbnail is the
              // keyboard's way in.
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest("button, a, input, select")) {
                  navigate({ screen: "design", name: entry.name });
                }
              }}
            >
              <button
                type="button"
                className="card-open"
                onClick={() => navigate({ screen: "design", name: entry.name })}
                aria-label={`Open ${entry.name}`}
              >
                <Thumbnail recipe={entry.recipe} />
              </button>
              <div className="card-body">
                <div className="card-head">
                  <h2>{entry.name}</h2>
                  <span className={`badge ${entry.status}`}>{STATUS_TEXT[entry.status]}</span>
                  {entry.builtIn && (
                    <span className="badge built-in" title="Listed in patterns/built-ins.txt, so every boot ships with it">
                      Built in
                    </span>
                  )}
                </div>
                {entry.savedAs && entry.savedAs !== entry.name && (
                  <p className="quiet small">Renamed from {entry.savedAs}</p>
                )}
                <p className="card-description">{entry.recipe.description || <span className="quiet">No description</span>}</p>
                <p className="chips">
                  {entry.recipe.layers.map((layer, i) => (
                    <span key={i} className={layer.enabled ? "chip" : "chip off"}>
                      {layer.label || LAYER_SPECS[layer.type]?.title || layer.type}
                    </span>
                  ))}
                </p>
                {entry.problems.length > 0 && <p className="small bad">{entry.problems[0]}</p>}
                {entry.conflict && (
                  <p className="small bad">
                    {entry.conflict === "changed" ? "The file changed on disk after this draft started." : "The file was deleted on disk after this draft started."}
                  </p>
                )}
                <div className="card-actions">
                  <button type="button" className="button small" onClick={() => navigate({ screen: "design", name: library.duplicate(entry.name) ?? entry.name })}>
                    Duplicate
                  </button>
                  <button type="button" className="button small" onClick={() => setDialog({ kind: "rename", entry })}>
                    Rename
                  </button>
                  <button type="button" className="button small" onClick={() => download(entry.recipe)}>
                    Download
                  </button>
                  {entry.status === "changed" && (
                    <button type="button" className="button small" onClick={() => library.discard(entry.name)}>
                      Discard changes
                    </button>
                  )}
                  <button type="button" className="button small danger-quiet" onClick={() => setDialog({ kind: "delete", entry })}>
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === "new" && (
        <NameDialog
          title="New pattern"
          initial={library.uniqueName("pattern")}
          confirmLabel="Create"
          problem={(name) => freeName(name)}
          onConfirm={create}
          onCancel={() => setDialog(null)}
        >
          <label className="field">
            <span className="field-label">Start from</span>
            <select value={startFrom} onChange={(event) => setStartFrom(event.target.value)}>
              <option value={BLANK}>Blank: one fill layer</option>
              {state.entries.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  A copy of {entry.name}
                </option>
              ))}
            </select>
          </label>
        </NameDialog>
      )}

      {dialog?.kind === "rename" && (
        <NameDialog
          title={`Rename ${dialog.entry.name}`}
          initial={dialog.entry.name}
          confirmLabel="Rename"
          problem={(name) => freeName(name, dialog.entry)}
          onConfirm={(name) => {
            const problem = library.rename(dialog.entry.name, name);
            setDialog(null);
            if (problem) setNotice(problem);
          }}
          onCancel={() => setDialog(null)}
        >
          {dialog.entry.savedAs && (
            <p className="field-help">The file is renamed when you save.</p>
          )}
        </NameDialog>
      )}

      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${dialog.entry.name}?`}
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            const problem = await library.remove(dialog.entry.name);
            setDialog(null);
            if (problem) setNotice(problem);
          }}
          onCancel={() => setDialog(null)}
        >
          {dialog.entry.savedAs ? (
            <p>
              This deletes <code>patterns/{dialog.entry.savedAs}.json</code> from the repo, and any unsaved changes. If the file
              was committed, git still has it.
              {dialog.entry.builtIn && " It also takes this recipe off the built-ins list, so boots stop shipping with it at their next firmware update."}
            </p>
          ) : (
            <p>This pattern was never saved, so it's gone for good.</p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

export function download(recipe: Recipe): void {
  const url = URL.createObjectURL(new Blob([recipeToJson(recipe)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${recipe.name}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
