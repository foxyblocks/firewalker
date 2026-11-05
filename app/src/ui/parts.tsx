/**
 * Small pieces shared across screens. The LED strips are the app's signature: brightness
 * and tilt are drawn as rows of pixels, like the strip on the boot they control.
 */

import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type { Side } from "../core/boots";
import type { LinkState } from "../core/boot";
import { firstPixelOver } from "../core/capMark";

const STRIP_PIXELS = 26;

export function LinkDot({ link }: { link?: LinkState }) {
  // A boot waiting on a tap isn't on its way back by itself, so it doesn't pulse.
  const tone = link === "online" ? "good" : link && link !== "needs-access" ? "wait" : "none";
  return <span className={`dot dot-${tone}`} aria-hidden="true" />;
}

export function Toggle({
  on,
  label,
  small,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  /** A compact size that fits beside a readout, as the brightness cap's does. */
  small?: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle${small ? " toggle-small" : ""}${on ? " toggle-on" : ""}`}
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

/** A level past which a slider warns, such as brightness over the soft cap while the cap is off. */
export interface SliderWarning {
  /** The highest level that's still recommended. */
  above: number;
  /** What the warning sign's button is called, such as "About the brightness cap". */
  label: string;
  /** Why the levels past it need care. A tap on the sign shows it, and the slider carries it for screen readers. */
  message: string;
}

/**
 * A slider drawn as a strip, whose pixels light up to show the value. It reads the finger's
 * position anywhere along the strip, which an iOS range input doesn't do. It reports
 * `onStart` and `onEnd` so the boot's echoes can't move the thumb mid-drag (see
 * BootClient.setDragging). The arrow keys step by one, through `onStep` when the caller has
 * its own idea of what one step means, such as hopping over a taken pixel.
 *
 * There are far fewer drawn pixels than values, so this shows roughly where the value sits.
 * A reading beside it should carry the exact number.
 *
 * With a `warning`, the pixels past it sit inside a yellow outline. Its left edge is the warning
 * line, in the gap before the first pixel over the warning (firstPixelOver in core/capMark.ts),
 * and it runs around every pixel to the end of the strip. A warning sign at the top of that edge
 * explains it on a tap.
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
  warning,
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
  warning?: SliderWarning;
}) {
  const track = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // Spacers the width of the outline's line, before the first pixel past the warning and after
  // the last pixel. The strip spaces every item evenly, so the outline drawn over them clears
  // the pixels inside it by the same space the pixels keep from each other.
  const edgeStart = useRef<HTMLSpanElement>(null);
  const edgeEnd = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  // Pixels from here on stand for levels past the warning. It's the pixel count when nothing is.
  const overFrom = warning && shape === "fill" ? firstPixelOver(warning.above, max, STRIP_PIXELS) : STRIP_PIXELS;
  const marked = warning !== undefined && overFrom < STRIP_PIXELS;

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

  // The wrapper is there whether or not anything is marked, so turning a warning on or off never
  // remounts the slider under a finger.
  return (
    <div ref={wrap} className="slider-wrap">
      {marked && <WarningZone wrap={wrap} edgeStart={edgeStart} edgeEnd={edgeEnd} warning={warning} overFrom={overFrom} />}
      <div
        ref={track}
        className={`strip strip-slider${disabled ? " strip-disabled" : ""}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-description={marked ? warning.message : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {Array.from({ length: STRIP_PIXELS }, (_, index) => (
          <Fragment key={index}>
            {marked && index === overFrom && <span ref={edgeStart} className="strip-edge" aria-hidden="true" />}
            <span className={`pixel${pixelLit(index) ? " pixel-lit" : ""}`} />
          </Fragment>
        ))}
        {marked && <span ref={edgeEnd} className="strip-edge" aria-hidden="true" />}
      </div>
    </div>
  );
}

/**
 * The outline around a slider's pixels past its warning, with the warning sign at the top of its
 * left edge. The sign is a button whose tap shows why those levels need care, in a tip that a
 * second tap, a tap anywhere else, or Escape closes. Both sit outside the slider, because a
 * slider's children are hidden from screen readers and a tap on the slider sets its value. The
 * outline lets taps through to the slider, and the sign's 44-pixel tap area reaches up from the
 * sign, so neither covers the pixels.
 *
 * The strip spaces its pixels to fit the screen, so this places the outline after layout, and
 * again whenever the strip resizes: from the left spacer's outer edge to the right spacer's, and
 * as far above and below the pixels as the left spacer is from the first pixel inside.
 */
function WarningZone({
  wrap,
  edgeStart,
  edgeEnd,
  warning,
  overFrom,
}: {
  wrap: RefObject<HTMLDivElement | null>;
  edgeStart: RefObject<HTMLSpanElement | null>;
  edgeEnd: RefObject<HTMLSpanElement | null>;
  warning: SliderWarning;
  overFrom: number;
}) {
  const [zone, setZone] = useState<{ left: number; top: number; width: number; height: number; gap: number } | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const tipId = useId();

  useLayoutEffect(() => {
    const place = () => {
      const box = wrap.current?.getBoundingClientRect();
      const start = edgeStart.current?.getBoundingClientRect();
      const end = edgeEnd.current?.getBoundingClientRect();
      const first = edgeStart.current?.nextElementSibling?.getBoundingClientRect();
      if (!box || !start || !end || !first) return setZone(null);
      // The space between the left spacer and the first pixel inside is the space between pixels.
      const gap = first.left - start.right;
      const reach = gap + start.width;
      setZone({
        left: start.left - box.left,
        top: first.top - box.top - reach,
        width: end.right - start.left,
        height: first.height + 2 * reach,
        gap,
      });
    };
    place();
    if (!wrap.current) return;
    const observer = new ResizeObserver(place);
    observer.observe(wrap.current);
    return () => observer.disconnect();
  }, [wrap, edgeStart, edgeEnd, overFrom]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (!button.current?.contains(target) && !tip.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (zone === null) return null;
  // The sign and the tip's caret point at the middle of the outline's left edge.
  const edgeX = zone.left + (edgeStart.current?.offsetWidth ?? 0) / 2;
  return (
    <>
      <span
        className="slider-zone"
        aria-hidden="true"
        style={{ left: zone.left, top: zone.top, width: zone.width, height: zone.height, "--zone-gap": `${zone.gap}px` } as CSSProperties}
      />
      <button
        ref={button}
        type="button"
        className="slider-mark-button"
        style={{ left: edgeX }}
        aria-label={warning.label}
        aria-expanded={open}
        aria-controls={open ? tipId : undefined}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen((shown) => !shown)}
      >
        <WarningIcon />
      </button>
      {open && (
        <div ref={tip} id={tipId} role="tooltip" className="slider-tip" style={{ "--mark-x": `${edgeX}px` } as CSSProperties}>
          {warning.message}
        </div>
      )}
    </>
  );
}

function WarningIcon() {
  return (
    <svg className="slider-mark-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path className="slider-mark-sign" d="M6 0.6 11.6 10.9H0.4Z" />
      <path className="slider-mark-glyph" d="M6 4.1V7.3" />
      <circle className="slider-mark-dot" cx="6" cy="9.1" r="0.8" />
    </svg>
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
