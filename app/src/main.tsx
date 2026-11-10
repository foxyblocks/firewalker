/** Desktop entry. The native Vite build uses native.tsx and never imports the designer. */
import "@fontsource-variable/big-shoulders-display";
import "@fontsource-variable/spline-sans-mono";
import "./ui/base.css";
import "./ui/styles.css";
import "./desktop/styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BootsStore } from "./core/boots";
import { setUpBoots } from "./transport/setup";
import { DesktopApp } from "./desktop/App";
import { SharedBootConnections } from "./desktop/bootConnections";
import { configureFakeRecipes } from "./desktop/fakeRecipes";

const { transport, storage } = await setUpBoots(configureFakeRecipes);
const store = new BootsStore(transport, storage);
await store.load();
// The hosted site talks directly to boots, but only localhost can inspect which
// program owns a USB port. Don't call local process endpoints on a static host.
const connections = new SharedBootConnections(store, import.meta.env.PROD ? {
  list: async () => [],
  free: async () => ({ freed: false, error: "USB process tools are available in the local app." }),
} : undefined);

createRoot(document.getElementById("root")!).render(
  <StrictMode><DesktopApp store={store} connections={connections} /></StrictMode>,
);
