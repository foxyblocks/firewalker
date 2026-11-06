import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Relative asset paths, because Capacitor serves the built app from inside the iOS
// bundle rather than from a web root. Chrome's Web Bluetooth and Web Serial need a secure
// context, and localhost counts as one, so the dev server stays on plain http.
export default defineConfig({
  base: "./",
  plugins: [react()],
  // Both web tools import repo-wide control defaults and inactivity logic.
  server: { host: "localhost", port: 5173, fs: { allow: [".."] } },
  test: { environment: "node", globals: true },
});
