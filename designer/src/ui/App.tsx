// Two screens: the pattern list (#/) and the designer for one pattern (#/design/<name>).
// The route lives in the URL hash, so a reload or a bookmark returns to the same place.

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { DesignScreen } from "./DesignScreen";
import { PatternsScreen } from "./PatternsScreen";
import { PatternLibrary, type LibraryState } from "../store/patterns";

const LibraryContext = createContext<PatternLibrary | null>(null);

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
      {route.screen === "design" ? <DesignScreen key={route.name} name={route.name} /> : <PatternsScreen />}
    </LibraryContext.Provider>
  );
}
