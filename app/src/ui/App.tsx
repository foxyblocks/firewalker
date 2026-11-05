/**
 * The app's frame: which screen is showing, and the checks that apply to all of them.
 * Every screen reads from `BootsStore` and re-renders when it changes, so there's no
 * other app-wide state. Bluetooth being off or denied replaces the whole app where Bluetooth
 * is the only way to reach a boot, because nothing else can work until it's fixed. A desktop
 * browser with USB carries on without it (`BrowserTransport.radioState`).
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { BootsStore } from "../core/boots";
import type { RadioState } from "../transport/transport";
import { CalibrateSheet } from "./CalibrateSheet";
import { FindBoots } from "./FindBoots";
import { Remote } from "./Remote";
import { Status } from "./Status";

type Screen = "remote" | "status" | "find";

export function App({ store }: { store: BootsStore }) {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const [screen, setScreen] = useState<Screen>(store.sides().length > 0 ? "remote" : "find");
  const [calibrating, setCalibrating] = useState(false);
  const [radio, setRadio] = useState<RadioState>("on");

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

  return (
    <div className="app">
      {store.transport.simulated && <div className="simulated">Simulated boots, not real ones</div>}
      {screen === "find" && (
        <FindBoots store={store} onDone={() => setScreen("remote")} onCalibrate={() => setCalibrating(true)} />
      )}
      {screen === "status" && <Status store={store} onBack={() => setScreen("remote")} />}
      {screen === "remote" && (
        <Remote store={store} onStatus={() => setScreen("status")} onBoots={() => setScreen("find")} />
      )}
      {calibrating && screen === "find" && (
        <CalibrateSheet store={store} onClose={() => setCalibrating(false)} />
      )}
    </div>
  );
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
