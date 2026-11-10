import "@fontsource-variable/big-shoulders-display";
import "@fontsource-variable/spline-sans-mono";
import "./ui/styles.css";
import "../../app/src/ui/base.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./ui/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
