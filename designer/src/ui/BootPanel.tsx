// The Send to boot panel: connect to boots over USB or Bluetooth, send the pattern you're looking at to
// one, and manage the recipes it holds. Sending uses the recipe as it is right now, so a change can be
// tried on a real boot before it's saved. Connections stay up while you move between patterns.

import { useEffect, useSyncExternalStore } from "react";

import { useBoots } from "./App";
import type { ConnectedBoot } from "../boot/connections";
import type { Recipe } from "../recipe/types";

const METHOD_LABEL = { usb: "Connect over USB", bluetooth: "Connect over Bluetooth" } as const;

export function BootPanel({ recipe, canSend, onClose }: { recipe: Recipe; canSend: boolean; onClose: () => void }) {
  const boots = useBoots();
  const state = useSyncExternalStore(boots.subscribe, boots.getSnapshot);

  useEffect(() => {
    void boots.prepare();
  }, [boots]);

  return (
    <section className="boot-panel" aria-label="Send to boot">
      <div className="boot-panel-head">
        <strong>Send to boot</strong>
        <div className="boot-panel-actions">
          {state.pickers.map((method) => (
            <button key={method} type="button" className="button small" disabled={state.connecting} onClick={() => void boots.connect(method)}>
              {METHOD_LABEL[method]}
            </button>
          ))}
          <button type="button" className="link" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {state.error && <p className="small bad">{state.error}</p>}
      {state.connecting && <p className="quiet small">Connecting…</p>}
      {state.ready && state.boots.length === 0 && !state.connecting && (
        <p className="quiet small">Connect a boot to try this pattern on the real strip. A boot takes one connection at a time.</p>
      )}

      <ul className="boot-list">
        {state.boots.map((boot) => (
          <BootRow key={boot.deviceId} boot={boot} recipe={recipe} canSend={canSend} />
        ))}
      </ul>
    </section>
  );
}

function BootRow({ boot, recipe, canSend }: { boot: ConnectedBoot; recipe: Recipe; canSend: boolean }) {
  const boots = useBoots();
  return (
    <li className="boot-row">
      <div className="boot-row-main">
        <strong>{boot.name}</strong>
        <button
          type="button"
          className="button small primary"
          disabled={boot.sending || !canSend}
          title={canSend ? undefined : "Fix the problems above first"}
          onClick={() => void boots.send(boot.deviceId, recipe)}
        >
          {boot.sending ? "Sending…" : `Send ${recipe.name}`}
        </button>
        <button type="button" className="button small" onClick={() => void boots.disconnect(boot.deviceId)}>
          Disconnect
        </button>
        {boot.activity && <span className={boot.failed ? "small bad" : "quiet small"}>{boot.activity}</span>}
      </div>
      {boot.uploads && boot.slots !== null && (
        <div className="boot-row-uploads quiet small">
          <span>
            {boot.uploads.length} of {boot.slots} recipe slots used
            {boot.uploads.length > 0 ? ":" : ""}
          </span>
          {boot.uploads.map((name) => (
            <span key={name} className="chip">
              {name}{" "}
              <button
                type="button"
                className="link"
                aria-label={`Delete ${name} from ${boot.name}`}
                onClick={() => void boots.deleteUpload(boot.deviceId, name)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
