import "@fontsource-variable/big-shoulders-display";
import "@fontsource-variable/spline-sans-mono";
import "./ui/styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./ui/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
