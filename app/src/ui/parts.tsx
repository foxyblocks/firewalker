/**
 * Small pieces shared across screens that know the app's own words, such as a boot's side or
 * link state. The generic controls live in `components/` and are re-exported here, so older
 * imports keep working.
 */

import type { LinkState } from "../core/boot";

export { Toggle } from "./components/Toggle";
export { PixelSlider, STRIP_PIXELS, type PixelSliderShape, type PixelTone, type SliderWarning } from "./components/PixelSlider";
export { TiltStrip } from "./components/TiltStrip";

export function LinkDot({ link }: { link?: LinkState }) {
  // A boot waiting on a tap isn't on its way back by itself, so it doesn't pulse.
  const tone = link === "online" ? "good" : link && link !== "needs-access" && link !== "sleeping" ? "wait" : "none";
  return <span className={`dot dot-${tone}`} aria-hidden="true" />;
}

/** Words for a boot's link, such as on its detail screen. */
export function linkWords(link: LinkState | undefined): string {
  switch (link) {
    case "online":
      return "Connected";
    case "sleeping":
      return "Paused, showing last report";
    case "connecting":
      return "Connecting";
    case "needs-access":
      return "Needs reconnecting";
    case "idle":
    case undefined:
      return "Not connected";
    default:
      return "Reconnecting";
  }
}

/** Joins boot names for a sentence, such as "Left and Right". */
export function joinNames(names: string[]): string {
  return names.join(" and ");
}
