/**
 * The app frame owns the persistent Remote/Boots pills and the current screen.
 * Boot details stay under Boots; capture sheets can lock the global navigation.
 * Every screen reads from `BootsStore` and re-renders when it changes. The only other
 * app-wide state is the list of boots Find boots has seen, which outlives that screen so a
 * boot's own screen can be opened from it and returned from. A boot's screen is keyed by its
 * device id, because labeling it can change its side. The desktop workspace can open directly
 * to the Boots tab and observes activity across both tools. When Bluetooth is unavailable,
 * the remote shows the radio prompt unless USB is available (`BrowserTransport.radioState`).
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { BootsStore } from "../core/boots";
import type { FoundBoot, RadioState } from "../transport/transport";
import { BootDetail } from "./BootDetail";
import { FindBoots, withFound } from "./FindBoots";
import { Remote } from "./Remote";
import { AppNavigation } from "./components/AppNavigation";

type Screen = { kind: "remote" } | { kind: "find" } | { kind: "boot"; deviceId: string };

export function App({ store, initialTab }: { store: BootsStore; initialTab?: "remote" | "boots" }) {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const [screen, setScreen] = useState<Screen>(() => ({
    kind: (initialTab ?? (store.sides().length > 0 ? "remote" : "boots")) === "remote" ? "remote" : "find",
  }));
  const [detailBusy, setDetailBusy] = useState(false);
  const [found, setFound] = useState<FoundBoot[]>([]);
  const [radio, setRadio] = useState<RadioState>("on");
  const addFound = useCallback((boot: FoundBoot) => setFound((current) => withFound(current, boot)), []);

  const checkRadio = useCallback(() => {
    void store.transport.radioState().then(setRadio);
  }, [store]);

  useEffect(() => {
    checkRadio();
    // iOS can drop links in the background, and Bluetooth may have changed meanwhile.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      checkRadio();
      store.resume();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [store, checkRadio]);

  if (radio !== "on") {
    return <RadioPrompt radio={radio} onRetry={checkRadio} onOpenSettings={() => void store.transport.openSettings()} />;
  }

  const mainTab = screen.kind === "remote" ? "remote" : "boots";

  return (
    <div className="app">
      {store.transport.simulated && <div className="simulated">Simulated boots, not real ones</div>}
      <AppNavigation
        value={mainTab}
        disabled={detailBusy}
        onChange={(tab) => {
          if (!detailBusy) setScreen({ kind: tab === "remote" ? "remote" : "find" });
        }}
      />
      {store.paused() && (
        <div className="banner banner-warn banner-action" role="status">
          <span>Boots disconnected. They keep running.</span>
          <button type="button" className="button" onClick={() => store.reconnectPaused()}>Reconnect</button>
        </div>
      )}
      <section className="app-content" id={`main-panel-${mainTab}`} role="tabpanel" aria-labelledby={`main-tab-${mainTab}`}>
        {screen.kind === "find" && (
          <FindBoots
            store={store}
            found={found}
            onFound={addFound}
            onOpen={(boot) => setScreen({ kind: "boot", deviceId: boot.deviceId })}
          />
        )}
        {screen.kind === "boot" && (
          <BootScreen store={store} deviceId={screen.deviceId} found={found} onBack={() => setScreen({ kind: "find" })} onBusy={setDetailBusy} />
        )}
        {screen.kind === "remote" && <Remote store={store} onBoots={() => setScreen({ kind: "find" })} />}
      </section>
    </div>
  );
}

/**
 * Finds the boot a detail screen is for: a labeled one by its device id, or one Find boots
 * has seen. A boot that's gone from both, such as one just forgotten, goes back to the list.
 */
function BootScreen({
  store,
  deviceId,
  found,
  onBack,
  onBusy,
}: {
  store: BootsStore;
  deviceId: string;
  found: FoundBoot[];
  onBack: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const side = store.sides().find((candidate) => store.known(candidate)?.deviceId === deviceId);
  const known = side ? store.known(side) : undefined;
  const boot: FoundBoot | undefined = known
    ? { deviceId: known.deviceId, name: known.name }
    : found.find((candidate) => candidate.deviceId === deviceId);
  const missing = boot === undefined;
  useEffect(() => {
    if (missing) onBack();
  }, [missing, onBack]);
  return boot ? <BootDetail key={deviceId} store={store} boot={boot} onBack={onBack} onBusy={onBusy} /> : null;
}

function RadioPrompt({
  radio,
  onRetry,
  onOpenSettings,
}: {
  radio: RadioState;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const copy = {
    off: { title: "Bluetooth is off", body: "Turn on Bluetooth to reach your boots. They keep running what they're running either way." },
    denied: { title: "Bluetooth isn't allowed", body: "Firewalker needs Bluetooth access to reach your boots. You can turn it on in Settings." },
    unsupported: { title: "No Bluetooth here", body: "This browser can't use Bluetooth. Open the app in Chrome, or add ?boot=fake to the address to try it with pretend boots." },
    on: { title: "", body: "" },
  }[radio];

  return (
    <div className="app prompt">
      <h1>{copy.title}</h1>
      <p>{copy.body}</p>
      {radio === "denied" && (
        <button type="button" className="button button-primary" onClick={onOpenSettings}>
          Open Settings
        </button>
      )}
      <button type="button" className="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
