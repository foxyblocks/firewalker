import { create } from "storybook/theming";

/** Storybook's own chrome in the remote's colors, so the design system reads as one piece. */
export const firewalkerTheme = create({
  base: "dark",
  brandTitle: "Firewalker design system",
  colorPrimary: "#ff6a1f",
  colorSecondary: "#ff6a1f",
  appBg: "#0b0a09",
  appContentBg: "#151311",
  appPreviewBg: "#0b0a09",
  appBorderColor: "#2e2a25",
  appBorderRadius: 10,
  barBg: "#151311",
  barTextColor: "#a79d90",
  barSelectedColor: "#ff6a1f",
  textColor: "#f4ede2",
  textMutedColor: "#a79d90",
  inputBg: "#1d1a17",
  inputBorder: "#2e2a25",
  inputTextColor: "#f4ede2",
  fontCode: "ui-monospace, Menlo, monospace",
});
