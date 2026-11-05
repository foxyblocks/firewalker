// Two screens: the pattern list (#/) and the designer for one pattern (#/design/<name>).
// The route lives in the URL hash, so a reload or a bookmark returns to the same place.

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { DesignScreen } from "./DesignScreen";
import { PatternsScreen } from "./PatternsScreen";
import { BootConnections, type BootTransport } from "../boot/connections";
import { PatternLibrary, type LibraryState } from "../store/patterns";

const LibraryContext = createContext<PatternLibrary | null>(null);
const BootsContext = createContext<BootConnections | null>(null);

export function useBoots(): BootConnections {
  const boots = useContext(BootsContext);
  if (!boots) throw new Error("useBoots needs the App's provider.");
  return boots;
}

// Real boots, or pretend ones with ?boot=fake, for trying the panel with no boot around. Both load only
// when the panel opens, because the real ones pull in the iPhone app's Bluetooth plugin.
async function loadBootTransport(): Promise<BootTransport> {
  if (new URLSearchParams(window.location.search).get("boot") === "fake") {
    const { FakeBootTransport } = await import("../boot/fakeBoot");
    return new FakeBootTransport();
  }
  const { createRealTransport } = await import("../boot/realTransport");
  return createRealTransport();
}

export function useLibrary(): [PatternLibrary, LibraryState] {
  const library = useContext(LibraryContext);
  if (!library) throw new Error("useLibrary needs the App's provider.");
  const state = useSyncExternalStore(library.subscribe, library.getSnapshot);
  return [library, state];
}

export type Route = { screen: "patterns" } | { screen: "design"; name: string };

export function navigate(route: Route): void {
  window.location.hash = route.screen === "design" ? `#/design/${encodeURIComponent(route.name)}` : "#/";
}

function readRoute(): Route {
  const match = /^#\/design\/(.+)$/.exec(window.location.hash);
  return match?.[1] ? { screen: "design", name: decodeURIComponent(match[1]) } : { screen: "patterns" };
}

export function App() {
  const library = useMemo(() => new PatternLibrary(), []);
  const boots = useMemo(() => new BootConnections(loadBootTransport), []);
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    void library.load();
    const onHash = () => setRoute(readRoute());
    // Coming back to this window is the likely moment for a git pull to have changed the files.
    const onFocus = () => void library.refresh();
    window.addEventListener("hashchange", onHash);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("focus", onFocus);
    };
  }, [library]);

  return (
    <LibraryContext.Provider value={library}>
      <BootsContext.Provider value={boots}>
        {route.screen === "design" ? <DesignScreen key={route.name} name={route.name} /> : <PatternsScreen />}
      </BootsContext.Provider>
    </LibraryContext.Provider>
  );
}
