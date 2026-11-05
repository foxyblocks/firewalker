// The boot from above and from the outer side, the strip in index order, and the motion
// controls: a tilt slider, a stomp button (or the space bar), a stomp on every beat, and a
// walking gait. The boot brightness setting shows what a boot's brightness does to the colors.

import { useEffect, useRef, useState } from "react";

import { Segmented, Slider } from "./controls";
import { BOOT_BRIGHTNESS, channelSteps } from "../engine/output";
import { STRIP_PRESETS } from "../engine/strip";
import { Simulation, type Readout } from "../sim/simulation";
import type { Recipe } from "../recipe/types";

const STRIPS = Object.fromEntries(STRIP_PRESETS.map((preset) => [preset.key, preset]));
// The firmware's dead zone reads exactly 0 near level, so the slider snaps there too.
const TILT_SNAP = 0.04;
const BPM_MIN = 30;
const BPM_MAX = 240;
const BRIGHTNESS_KEY = "firewalker-designer:boot-brightness";

// The brightness last used in this browser, so it carries from one pattern to the next.
function readStoredBrightness(): number {
  try {
    const stored = Number(localStorage.getItem(BRIGHTNESS_KEY));
    if (Number.isInteger(stored) && stored >= BOOT_BRIGHTNESS.min && stored <= BOOT_BRIGHTNESS.max) return stored;
  } catch {
    // Storage can be blocked. The setting still works until the page closes.
  }
  return BOOT_BRIGHTNESS.default;
}

function storeBrightness(brightness: number): void {
  try {
    localStorage.setItem(BRIGHTNESS_KEY, String(brightness));
  } catch {
    // Storage can be blocked or full, and this is only a convenience.
  }
}

export function SimulatorPanel({ recipe }: { recipe: Recipe }) {
  const topRef = useRef<HTMLCanvasElement>(null);
  const sideRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation | null>(null);
  const recipeRef = useRef(recipe);
  recipeRef.current = recipe;

  const [tilt, setTilt] = useState(0);
  const [strength, setStrength] = useState(0.7);
  const [walking, setWalking] = useState(false);
  const [beating, setBeating] = useState(false);
  const [bpm, setBpm] = useState(100);
  // What's typed in the BPM box, which can be part way to a number in range.
  const [bpmText, setBpmText] = useState("100");
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState("1");
  const [strip, setStrip] = useState(STRIP_PRESETS[0]!.key);
  const [brightness, setBrightness] = useState(readStoredBrightness);
  const [readout, setReadout] = useState<Readout>({ tilt: 0, lastStomp: null, stomps: 0, timeMs: 0 });
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const sim = new Simulation(recipeRef.current, STRIPS[strip]!.layout);
    simRef.current = sim;
    sim.start({ top: topRef.current!, side: sideRef.current!, strip: stripRef.current! }, setReadout);
    return () => sim.stop();
  }, []);

  useEffect(() => simRef.current?.setRecipe(recipe), [recipe]);
  useEffect(() => simRef.current?.setTilt(tilt), [tilt]);
  useEffect(() => simRef.current?.setWalking(walking), [walking]);
  useEffect(() => simRef.current?.setBeat(beating ? bpm : null, strength), [beating, bpm, strength]);
  useEffect(() => simRef.current?.setPaused(paused), [paused]);
  useEffect(() => simRef.current?.setSpeed(Number(speed)), [speed]);
  useEffect(() => simRef.current?.setLayout(recipeRef.current, STRIPS[strip]!.layout), [strip]);
  useEffect(() => simRef.current?.setBootBrightness(brightness), [brightness]);

  const stomp = () => simRef.current?.stomp(strength);

  // The button lights when a stomp lands, whatever started it.
  useEffect(() => {
    if (readout.stomps === 0) return;
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 120);
    return () => window.clearTimeout(timer);
  }, [readout.stomps]);

  // Space stomps, unless you're typing somewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement;
      if (target.closest("input[type=text], textarea, select, [contenteditable]")) return;
      event.preventDefault();
      stomp();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const shownTilt = walking ? readout.tilt : tilt;

  return (
    <section className="simulator">
      <div className="views">
        <figure className="view view-top">
          <canvas ref={topRef} aria-label="The boot from above" />
          <figcaption>Top</figcaption>
        </figure>
        <figure className="view view-side">
          <canvas ref={sideRef} aria-label="The boot from the outer side" />
          <figcaption>Outer side</figcaption>
        </figure>
      </div>
      <figure className="view view-strip">
        <canvas ref={stripRef} aria-label="The strip in index order" />
      </figure>

      <div className="sim-controls">
        <div className="control tilt">
          <div className="field-head">
            <span className="field-label">Tilt</span>
            <span className="readout">{describeTilt(shownTilt)}</span>
          </div>
          <input
            type="range"
            aria-label="Tilt"
            min={-1}
            max={1}
            step={0.01}
            value={shownTilt}
            disabled={walking}
            onChange={(event) => {
              const value = Number(event.target.value);
              setTilt(Math.abs(value) < TILT_SNAP ? 0 : value);
            }}
            onDoubleClick={() => setTilt(0)}
          />
          <div className="tilt-scale" aria-hidden="true">
            <span>Heel down</span>
            <span>Flat</span>
            <span>Toe down</span>
          </div>
        </div>

        <div className="control stomp">
          <button type="button" className={flash ? "stomp-button hit" : "stomp-button"} onClick={stomp}>
            Stomp <kbd>Space</kbd>
          </button>
          <div className="stomp-strength">
            <span className="field-label">Strength</span>
            <Slider label="Stomp strength" value={strength} min={0} max={1} step={0.05} onChange={setStrength} />
          </div>
          <span className="quiet small">
            {readout.lastStomp === null ? "No stomp yet" : `Last stomp ${readout.lastStomp.toFixed(2)}`}
          </span>
        </div>

        <div className="control brightness" title="What a boot's brightness setting does to this pattern. A new boot starts at 16.">
          <div className="field-head">
            <span className="field-label">Boot brightness</span>
            <span className="readout">{channelSteps(brightness)} steps per color</span>
          </div>
          <Slider
            label="Boot brightness"
            value={brightness}
            min={BOOT_BRIGHTNESS.min}
            max={BOOT_BRIGHTNESS.max}
            step={1}
            integer
            onChange={(value) => {
              setBrightness(value);
              storeBrightness(value);
            }}
          />
        </div>

        <div className="control playback">
          <button
            type="button"
            className={walking ? "button on" : "button"}
            aria-pressed={walking}
            onClick={() => {
              setWalking(!walking);
              setBeating(false);
            }}
          >
            {walking ? "Stop walking" : "Walk"}
          </button>
          <div className="beat">
            <button
              type="button"
              className={beating ? "button on" : "button"}
              aria-pressed={beating}
              title="Stomp on every beat, at the strength above"
              onClick={() => {
                setBeating(!beating);
                setWalking(false);
              }}
            >
              {beating ? "Stop beat" : "Beat"}
            </button>
            <input
              type="number"
              aria-label="Beats per minute"
              min={BPM_MIN}
              max={BPM_MAX}
              step={1}
              value={bpmText}
              onChange={(event) => {
                setBpmText(event.target.value);
                const value = Number(event.target.value);
                if (value >= BPM_MIN && value <= BPM_MAX) setBpm(Math.round(value));
              }}
              onBlur={() => setBpmText(String(bpm))}
            />
            <span className="quiet small">BPM</span>
          </div>
          <button type="button" className="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>
            {paused ? "Play" : "Pause"}
          </button>
          <button type="button" className="button" onClick={() => simRef.current?.reset()}>
            Restart
          </button>
          <Segmented
            label="Speed"
            value={speed}
            options={[
              { value: "0.25", label: "¼×" },
              { value: "0.5", label: "½×" },
              { value: "1", label: "1×" },
            ]}
            onChange={setSpeed}
          />
          <select aria-label="Strip" value={strip} onChange={(event) => setStrip(event.target.value)}>
            {Object.entries(STRIPS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}

function describeTilt(tilt: number): string {
  if (tilt === 0) return "0.00 flat";
  return `${tilt > 0 ? "+" : ""}${tilt.toFixed(2)} ${tilt > 0 ? "toe down" : "heel down"}`;
}
