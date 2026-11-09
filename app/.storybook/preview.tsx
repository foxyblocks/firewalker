import "@fontsource-variable/big-shoulders-display";
import "@fontsource-variable/spline-sans-mono";
import "../src/ui/styles.css";
import "./preview.css";

import type { Preview } from "@storybook/react-vite";
import { firewalkerTheme } from "./theme";

/**
 * The phones the remote is laid out for, where the small one is the tightest dock, and the
 * desktop sizes the Studio design is drawn at.
 */
const VIEWPORTS = {
  phoneSmall: { name: "Small phone (375 × 667)", styles: { width: "375px", height: "667px" }, type: "mobile" },
  phone: { name: "Phone (393 × 852)", styles: { width: "393px", height: "852px" }, type: "mobile" },
  phoneLarge: { name: "Large phone (430 × 932)", styles: { width: "430px", height: "932px" }, type: "mobile" },
  laptop: { name: "Laptop (1280 × 800)", styles: { width: "1280px", height: "800px" }, type: "desktop" },
  studio: { name: "Studio desktop (1440 × 900)", styles: { width: "1440px", height: "900px" }, type: "desktop" },
} as const;

const preview: Preview = {
  parameters: {
    layout: "padded",
    backgrounds: {
      options: { night: { name: "Night", value: "#0b0a09" }, surface: { name: "Surface", value: "#151311" } },
    },
    viewport: { options: VIEWPORTS },
    docs: { theme: firewalkerTheme },
    options: {
      storySort: {
        order: [
          "Design system",
          ["Introduction", "Color", "Typography", "Space and shape", "Glow and motion", "LED language", "Icons", "Writing", "Accessibility", "Studio readiness"],
          "Components",
          ["Actions", "Inputs", "Status", "Data", "Navigation", "Overlays"],
          "Patterns",
          "Sheets",
          "Screens",
        ],
      },
    },
    controls: { matchers: { color: /(background|color)$/i } },
  },
  initialGlobals: {
    backgrounds: { value: "night" },
  },
};

export default preview;
