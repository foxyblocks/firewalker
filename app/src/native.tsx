import "@fontsource-variable/big-shoulders-display";
import "@fontsource-variable/spline-sans-mono";
import "./ui/base.css";
import "./ui/styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BootsStore } from "./core/boots";
import { setUpBoots } from "./transport/setup";
import { App } from "./ui/App";

const { transport, storage } = await setUpBoots();
const store = new BootsStore(transport, storage);
await store.load();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="remote-surface"><App store={store} /></div>
  </StrictMode>,
);
