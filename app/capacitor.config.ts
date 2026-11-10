import type { CapacitorConfig } from "@capacitor/cli";

// There is deliberately no `server.url` here. The UI ships inside the app bundle, so
// the remote works with no network at all.
const config: CapacitorConfig = {
  appId: "com.foxyblocks.firewalker",
  appName: "Firewalker",
  webDir: "dist-native",
  backgroundColor: "#0b0a09",
  ios: { contentInset: "never" },
};

export default config;
