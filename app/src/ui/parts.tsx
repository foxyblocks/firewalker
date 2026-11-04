/**
 * Small pieces shared across screens. The LED strips are the app's signature: brightness
 * and tilt are drawn as rows of pixels, like the strip on the boot they control.
 */

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { Side } from "../core/boots";
import type { LinkState } from "../core/boot";

const STRIP_PIXELS = 26;

export function LinkDot({ link }: { link?: LinkState }) {
  const tone = link === "online" ? "good" : link ? "wait" : "none";
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

/**
 * The brightness slider, drawn as a strip whose pixels light up to the current level.
 * It reads the finger's position anywhere along the strip, which an iOS range input
 * doesn't do. It reports `onStart` and `onEnd` so the boot's echoes can't move the thumb
 * mid-drag (see BootClient.setDragging).
 */
export function BrightnessStrip({
  value,
  max,
  disabled,
  onStart,
  onChange,
  onEnd,
}: {
  value: number;
  max: number;
  disabled?: boolean;
  onStart: () => void;
  onChange: (value: number) => void;
  onEnd: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const fraction = max > 0 ? value / max : 0;

  const levelAt = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    return Math.max(1, Math.round(position * max));
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
    onChange(Math.max(1, Math.min(max, value + step)));
  };

  return (
    <div
      ref={track}
      className={`strip strip-slider${disabled ? " strip-disabled" : ""}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Brightness"
      aria-valuemin={1}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {Array.from({ length: STRIP_PIXELS }, (_, index) => {
        const lit = (index + 0.5) / STRIP_PIXELS <= fraction || (index === 0 && value > 0);
        return <span key={index} className={`pixel${lit ? " pixel-lit" : ""}`} />;
      })}
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
