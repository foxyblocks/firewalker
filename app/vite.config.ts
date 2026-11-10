import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { desktopPlugins } from "./build/desktop.ts";

// Relative asset paths, because Capacitor serves the built app from inside the iOS
// bundle rather than from a web root. Chrome's Web Bluetooth and Web Serial need a secure
// context, and localhost counts as one, so the dev server stays on plain http.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), ...(mode === "native" ? [{
    name: "firewalker-native-entry",
    transformIndexHtml: {
      order: "pre" as const,
      handler(html: string) { return html.replace('/src/main.tsx', '/src/native.tsx'); },
    },
  }] : desktopPlugins())],
  build: { outDir: mode === "native" ? "dist-native" : "dist" },
  resolve: { dedupe: ["react", "react-dom"] },
  // Both web tools import repo-wide control defaults and inactivity logic.
  server: { host: "localhost", port: 5173, strictPort: true, fs: { allow: [".."] } },
  test: { environment: "node", globals: true },
}));
