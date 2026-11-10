/**
 * Desktop navigation around the remote and recipe designer. BootsStore lives above
 * both sections, so changing screens preserves connections and pending uploads.
 * The designer loads on first use and its library lives for the whole app session.
 * Only the visible section mounts: leaving a simulator stops audio and shortcuts,
 * and leaving calibration removes temporary strip previews and debug subscriptions.
 */
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BootsStore } from "../core/boots";
import { App as Remote } from "../ui/App";
import type { SharedBootConnections } from "./bootConnections";

const Designer = lazy(() => import("./Designer"));
const readHash = () => window.location.hash || "#/remote";

export function DesktopApp({ store, connections }: { store: BootsStore; connections: SharedBootConnections }) {
  const [hash, setHash] = useState(readHash);
  const lastDesigner = useRef("#/patterns");
  useSyncExternalStore(store.subscribe, store.getVersion);
  const designing = hash === "#/" || hash.startsWith("#/patterns") || hash.startsWith("#/design/");

  useEffect(() => store.observeActivity(), [store]);
  useEffect(() => {
    const update = () => {
      const next = readHash();
      if (next === "#/" || next.startsWith("#/patterns") || next.startsWith("#/design/")) lastDesigner.current = next;
      setHash(next);
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  return (
    <div className="desktop-app">
      <header className="workspace-bar">
        <a className="workspace-brand" href="#/remote" aria-label="Firewalker remote">
          <span className="brand-pixels" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          FIREWALKER
        </a>
        <nav className="workspace-nav" aria-label="Workspace">
          <a href="#/remote" aria-current={!designing ? "page" : undefined}>Remote</a>
          <a href={lastDesigner.current} aria-current={designing ? "page" : undefined}>Designer</a>
        </nav>
        <a className="workspace-boots" href="#/remote/boots" aria-label="Manage boots">
          {store.sides().length === 0 ? "Connect boots ↗" : store.sides().map((side) => (
            <span key={side}><i className={store.client(side)?.getState().link === "online" ? "online" : "offline"} />{store.displayName(side)}</span>
          ))}
        </a>
      </header>
      <div className={designing ? "workspace-content" : "workspace-content workspace-remote"}>
        {designing ? (
          <Suspense fallback={<p className="workspace-loading" role="status">Opening the designer…</p>}>
            <Designer connections={connections} />
          </Suspense>
        ) : (
          <div className="remote-surface">
            <Remote key={hash} store={store} manageActivity={false} initialTab={hash === "#/remote/boots" ? "boots" : undefined} />
          </div>
        )}
      </div>
      <footer className="workspace-footer">
        <span>{transportLabel(store)}</span>
        <span>{designing ? "DESIGN · SIMULATE · SEND" : "TWO BOOTS. ONE REMOTE."}</span>
      </footer>
    </div>
  );
}

function transportLabel(store: BootsStore): string {
  if (store.transport.simulated) return "SIMULATED BOOTS";
  return store.paused() ? "CONNECTIONS PAUSED" : "BLUETOOTH / USB";
}
