import type { StorybookConfig } from "@storybook/react-vite";
import remarkGfm from "remark-gfm";

// Stories sit beside the components they show, under src/ui. The Design system pages are MDX
// in src/ui/stories/design-system, with GitHub-style tables. The app's own vite.config.ts
// supplies React and the repo-wide file access the screens need.
const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
  addons: [
    {
      name: "@storybook/addon-docs",
      options: { mdxPluginOptions: { mdxCompileOptions: { remarkPlugins: [remarkGfm] } } },
    },
  ],
  core: { disableTelemetry: true },
};

export default config;
