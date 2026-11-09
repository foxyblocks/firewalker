/**
 * What each design token is for, shown on Storybook's Design system pages. The values
 * themselves live only in ../tokens.css, and the pages read them from the running page, so
 * they never drift. tokens.test.ts checks that this list and tokens.css name the same tokens.
 */

export interface TokenDoc {
  /** The custom property, such as `--ember`. */
  name: string;
  /** What it's for, in a sentence. */
  use: string;
}

export interface TokenGroup {
  title: string;
  /** One line on the group as a whole. */
  lead: string;
  tokens: TokenDoc[];
}

export const COLOR_GROUPS: TokenGroup[] = [
  {
    title: "Ground",
    lead: "Darkest to lightest. Every surface is near black, because the remote is used at night.",
    tokens: [
      { name: "--night", use: "The page behind everything." },
      { name: "--surface", use: "Cards, panels, tiles, and sheets." },
      { name: "--surface-raised", use: "Controls on a card: buttons, fields, the chosen joined tab." },
      { name: "--surface-high", use: "Unlit LEDs on a raised surface. The designer uses it today." },
      { name: "--line", use: "Hairlines, outlines, and unlit pixels." },
      { name: "--night-veil", use: "The pinned dock, so patterns scroll under it." },
      { name: "--scrim", use: "Behind an open sheet." },
      { name: "--hover-wash", use: "A pointer over an icon button." },
    ],
  },
  {
    title: "Ink",
    lead: "Three steps of text. Quiet is for hints and labels, faint for scales and disabled hints.",
    tokens: [
      { name: "--ink", use: "Body text, values, and names." },
      { name: "--ink-quiet", use: "Hints, labels, and secondary lines." },
      { name: "--ink-faint", use: "Chart scales, unlit knobs, and the idle status dot." },
    ],
  },
  {
    title: "Ember",
    lead: "The one accent. It means chosen, on, or primary, and it's never decoration.",
    tokens: [
      { name: "--ember", use: "Chosen tabs, on switches, primary buttons, lit pixels, and focus rings." },
      { name: "--ember-pressed", use: "A primary button while it's pressed." },
      { name: "--ember-soft", use: "The fill behind a chosen tab, an on switch, or an on button." },
      { name: "--ember-wash", use: "The glow and gradient of a chosen tab or running pattern tile." },
    ],
  },
  {
    title: "Status",
    lead: "Good is connected or saved, wait is working or needs a step, bad has failed.",
    tokens: [
      { name: "--good", use: "Connected dots, saved lines, and a captured pose." },
      { name: "--good-soft", use: "Behind a captured pose step." },
      { name: "--wait", use: "Connecting, saving, a missing calibration, and the soft-cap outline." },
      { name: "--bad", use: "A failed save, a missing sensor, and Forget." },
      { name: "--bad-soft", use: "Behind a failed step, or a pressed danger button." },
    ],
  },
  {
    title: "Strip",
    lead: "The colors the real strip shows during strip setup, matching include/config.h.",
    tokens: [
      { name: "--led-ring", use: "Every pixel in the ring, while setting the LED count." },
      { name: "--led-toe", use: "The pixel at the toe." },
      { name: "--led-heel", use: "The pixel at the heel." },
    ],
  },
];

export const GLOW_TOKENS: TokenDoc[] = [
  { name: "--glow-ember", use: "A lit ember pixel." },
  { name: "--glow-ember-strong", use: "An on switch's knob." },
  { name: "--glow-ember-soft", use: "The audio waveform line." },
  { name: "--glow-good", use: "A connected dot." },
  { name: "--glow-ring", use: "A lit ring pixel in strip setup." },
  { name: "--glow-toe", use: "The lit toe pixel." },
  { name: "--glow-heel", use: "The lit heel pixel." },
];

export const SHADOW_TOKENS: TokenDoc[] = [
  { name: "--shadow-chosen", use: "A chosen large tab, such as Both, Left, or Right." },
  { name: "--shadow-popover", use: "A popover above content, such as the cap warning." },
  { name: "--shadow-segment", use: "The chosen half of a joined tab bar." },
];

export const PREVIEW_TOKENS: TokenDoc[] = [
  { name: "--preview-rainbow", use: "Pattern tiles for tilt patterns that pool color." },
  { name: "--preview-fire", use: "Pattern tiles for stomp patterns that launch fire." },
];

export const FONT_TOKENS: TokenDoc[] = [
  { name: "--display", use: "Big Shoulders Display: names, controls, tabs, and titles, always uppercase." },
  { name: "--mono", use: "Spline Sans Mono: everything you read, and every number." },
];

/** Type sizes, largest first. `sample` is shown in the size's own face. */
export const TYPE_TOKENS: (TokenDoc & { face: "display" | "mono"; sample: string; usedBy: string })[] = [
  { name: "--text-display", face: "display", sample: "Bluetooth is off", use: "A whole-screen prompt.", usedBy: ".prompt h1" },
  { name: "--text-title", face: "display", sample: "Left", use: "A screen's title.", usedBy: ".screen-title" },
  { name: "--text-tile", face: "display", sample: "Rainbow pool", use: "A pattern tile's name.", usedBy: ".tile-name" },
  { name: "--text-card", face: "display", sample: "Debug output", use: "Card names, tabs, and big numbers.", usedBy: ".card-name, .tab, .strip-number" },
  { name: "--text-control", face: "display", sample: "Capture neutral", use: "Button and joined-tab labels.", usedBy: ".button, .tabs-joined .tab" },
  { name: "--text-control-compact", face: "display", sample: "Rename", use: "Compact buttons and text fields.", usedBy: ".button-compact, .input" },
  { name: "--text-section", face: "display", sample: "Brightness", use: "Section labels above a group.", usedBy: ".section-label" },
  { name: "--text-body", face: "mono", sample: "Saved on Left and Right", use: "Body text and readouts.", usedBy: "body" },
  { name: "--text-small", face: "mono", sample: "Reconnecting to Right.", use: "Banners, notices, help, and tight fact rows.", usedBy: ".banner, .notice, .help" },
  { name: "--text-caption", face: "mono", sample: "Waiting for motion readings.", use: "Small help and step failures.", usedBy: ".help-small, .step-failure" },
  { name: "--text-hint", face: "mono", sample: "Tilt pools color", use: "Hints under a name, save lines, and strip ends.", usedBy: ".tile-hint, .save-line, .strip-ends" },
  { name: "--text-label", face: "mono", sample: "TILT", use: "Field labels and side badges.", usedBy: ".field-label, .badge" },
  { name: "--text-micro", face: "mono", sample: "-22.5°", use: "Pose angles and tags.", usedBy: ".pose-degrees, .side-tag" },
  { name: "--text-chart", face: "mono", sample: "20", use: "Scale numbers inside a graph.", usedBy: ".history-scale" },
];

export const SPACE_TOKENS: TokenDoc[] = [
  { name: "--space-1", use: "Between a dot and its label." },
  { name: "--space-2", use: "Between controls in a row." },
  { name: "--space-3", use: "Padding inside a compact card." },
  { name: "--space-4", use: "The screen gutter and the gap between cards." },
  { name: "--space-5", use: "Between sections on a wide screen." },
  { name: "--space-6", use: "Page padding on a wide screen." },
  { name: "--gap", use: "An alias for --space-4, kept for existing styles." },
];

export const RADIUS_TOKENS: TokenDoc[] = [
  { name: "--radius-xs", use: "Banners and notices." },
  { name: "--radius-sm", use: "Graphs, popovers, and step buttons." },
  { name: "--radius-md", use: "Buttons, fields, and steps." },
  { name: "--radius-lg", use: "Cards, panels, tiles, and joined tab bars." },
  { name: "--radius-sheet", use: "A sheet's top corners." },
  { name: "--radius-pill", use: "Pills and tags." },
  { name: "--radius", use: "An alias for --radius-lg, kept for existing styles." },
];

export const SIZE_TOKENS: TokenDoc[] = [
  { name: "--target", use: "The smallest thing a finger can tap." },
  { name: "--phone-column", use: "The widest the phone layout and its sheets grow." },
];

export const MOTION_TOKENS: TokenDoc[] = [
  { name: "--duration-pixel", use: "A pixel lighting or dimming as a slider moves." },
  { name: "--duration-quick", use: "A switch knob or a chevron turning." },
  { name: "--duration-pulse", use: "One breath of a waiting dot or a busy icon." },
  { name: "--duration-capture", use: "A pose capture, matching the firmware's two-second read." },
  { name: "--ease-standard", use: "The easing for quick feedback." },
];

/** Every documented token, for the drift test. */
export const ALL_TOKENS: TokenDoc[] = [
  ...COLOR_GROUPS.flatMap((group) => group.tokens),
  ...GLOW_TOKENS,
  ...SHADOW_TOKENS,
  ...PREVIEW_TOKENS,
  ...FONT_TOKENS,
  ...TYPE_TOKENS,
  ...SPACE_TOKENS,
  ...RADIUS_TOKENS,
  ...SIZE_TOKENS,
  ...MOTION_TOKENS,
];
