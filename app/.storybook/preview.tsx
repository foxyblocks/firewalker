import "@fontsource-variable/big-shoulders-display";
import "@fontsource-variable/spline-sans-mono";
import "../src/ui/styles.css";
import "./preview.css";

import type { Preview } from "@storybook/react-vite";

/** The phones the remote is laid out for. The small one is the tightest dock. */
const PHONES = {
  phoneSmall: { name: "Small phone (375 × 667)", styles: { width: "375px", height: "667px" }, type: "mobile" },
  phone: { name: "Phone (393 × 852)", styles: { width: "393px", height: "852px" }, type: "mobile" },
  phoneLarge: { name: "Large phone (430 × 932)", styles: { width: "430px", height: "932px" }, type: "mobile" },
} as const;

const preview: Preview = {
  parameters: {
    layout: "padded",
    backgrounds: {
      options: { night: { name: "Night", value: "#0b0a09" }, surface: { name: "Surface", value: "#151311" } },
    },
    viewport: { options: PHONES },
    controls: { matchers: { color: /(background|color)$/i } },
  },
  initialGlobals: {
    backgrounds: { value: "night" },
  },
};

export default preview;
