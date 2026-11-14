/**
 * The iPhone build's entry (`bun run build:native`). It never imports the designer. Beyond the
 * remote itself, it keeps boots in step with main: `PatternLibrary` downloads main's pattern
 * catalog at launch and whenever the app returns to the foreground, and `PatternSync` puts it on
 * each boot as it connects (docs/adr/0007-sync-patterns-from-main.md). The desktop app (main.tsx)
 * leaves boots to the designer instead.
 */
import "@fontsource-variable/big-shoulders-display";
import "@fontsource-variable/spline-sans-mono";
import "./ui/base.css";
import "./ui/styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BootsStore } from "./core/boots";
import { CATALOG_URL, PatternLibrary } from "./core/patternLibrary";
import { PatternSync } from "./core/patternSync";
import { catalogUrl, fetchCatalogText } from "./transport/catalogFetch";
import { attachFakeRecipes } from "./transport/fakeRecipes";
import { setUpBoots } from "./transport/setup";
import { App } from "./ui/App";

const { transport, storage } = await setUpBoots(attachFakeRecipes);
const store = new BootsStore(transport, storage);
await store.load();

const library = new PatternLibrary(storage, fetchCatalogText, { url: catalogUrl(CATALOG_URL) });
await library.load();
const sync = new PatternSync(store, library, storage);
sync.start();
void library.refresh();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void library.refresh();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="remote-surface"><App store={store} sync={sync} /></div>
  </StrictMode>,
);
