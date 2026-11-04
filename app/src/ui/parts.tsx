/**
 * Small pieces shared across screens. The LED strips are the app's signature: brightness
 * and tilt are drawn as rows of pixels, like the strip on the boot they control.
 */

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { Side } from "../core/boots";
import type { LinkState } from "../core/boot";

const STRIP_PIXELS = 26;

export function LinkDot({ link }: { link?: LinkState }) {
  // A boot waiting on a tap isn't on its way back by itself, so it doesn't pulse.
  const tone = link === "online" ? "good" : link && link !== "needs-access" ? "wait" : "none";
  return <span className={`dot dot-${tone}`} aria-hidden="true" />;
}

export function Toggle({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle${on ? " toggle-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

/** "fill" lights the strip up to the value, and "point" lights one pixel at the value. */
export type PixelSliderShape = "fill" | "point";
/** Set on an ancestor as `led-<tone>` to color the lit pixels. Ember otherwise. */
export type PixelTone = "blue" | "yellow" | "purple";

/**
 * A slider drawn as a strip, whose pixels light up to show the value. It reads the finger's
 * position anywhere along the strip, which an iOS range input doesn't do. It reports
 * `onStart` and `onEnd` so the boot's echoes can't move the thumb mid-drag (see
 * BootClient.setDragging). The arrow keys step by one, through `onStep` when the caller has
 * its own idea of what one step means, such as hopping over a taken pixel.
 *
 * There are far fewer drawn pixels than values, so this shows roughly where the value sits.
 * A reading beside it should carry the exact number.
 */
export function PixelSlider({
  label,
  value,
  min,
  max,
  shape = "fill",
  disabled,
  onStart,
  onChange,
  onStep,
  onEnd,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  shape?: PixelSliderShape;
  disabled?: boolean;
  onStart: () => void;
  onChange: (value: number) => void;
  onStep?: (step: 1 | -1) => void;
  onEnd: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const levelAt = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    return Math.max(min, Math.round(min + position * (max - min)));
  };

  const pixelLit = (index: number) => {
    if (shape === "fill") {
      const fraction = max > 0 ? value / max : 0;
      return (index + 0.5) / STRIP_PIXELS <= fraction || (index === 0 && value > 0);
    }
    const position = max > min ? (value - min) / (max - min) : 0;
    return index === Math.round(position * (STRIP_PIXELS - 1));
  };

  const onPointerDown = (event: PointerEvent) => {
    if (disabled) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onStart();
    onChange(levelAt(event.clientX));
  };
  const onPointerMove = (event: PointerEvent) => {
    if (dragging.current) onChange(levelAt(event.clientX));
  };
  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onEnd();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    if (!step || disabled) return;
    event.preventDefault();
    if (onStep) onStep(step);
    else onChange(Math.max(min, Math.min(max, value + step)));
  };

  return (
    <div
      ref={track}
      className={`strip strip-slider${disabled ? " strip-disabled" : ""}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {Array.from({ length: STRIP_PIXELS }, (_, index) => (
        <span key={index} className={`pixel${pixelLit(index) ? " pixel-lit" : ""}`} />
      ))}
    </div>
  );
}

/**
 * Live tilt as a strip: light pools from the center toward whichever end is down, which
 * is roughly what the flow pattern does on the boot itself.
 */
export function TiltStrip({ tilt }: { tilt: number }) {
  const center = (STRIP_PIXELS - 1) / 2;
  const reach = tilt * center;
  return (
    <div className="strip strip-tilt" role="img" aria-label={`Tilt ${tilt.toFixed(2)}`}>
      {Array.from({ length: STRIP_PIXELS }, (_, index) => {
        const offset = index - center;
        const inPool = Math.abs(offset) < 1 || (Math.sign(offset) === Math.sign(reach) && Math.abs(offset) <= Math.abs(reach));
        return <span key={index} className={`pixel${inPool ? " pixel-lit" : ""}`} />;
      })}
    </div>
  );
}

export function SideBadge({ side }: { side: Side }) {
  return <span className="badge">{side === "left" ? "L" : "R"}</span>;
}

/** Joins boot names for a sentence, such as "Left and Right". */
export function joinNames(names: string[]): string {
  return names.join(" and ");
}
