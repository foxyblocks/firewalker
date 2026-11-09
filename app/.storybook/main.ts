import type { StorybookConfig } from "@storybook/react-vite";

// Stories sit beside the components they show, under src/ui. The app's own vite.config.ts
// supplies React and the repo-wide file access the screens need.
const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  core: { disableTelemetry: true },
};

export default config;
