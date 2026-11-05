// The boot from above and from the outer side, the strip in index order, and the motion
// controls: a tilt slider, a stomp button (or the space bar), and a walking gait.

import { useEffect, useRef, useState } from "react";

import { Segmented, Slider } from "./controls";
import { STRIP_PRESETS } from "../engine/strip";
import { Simulation, type Readout } from "../sim/simulation";
import type { Recipe } from "../recipe/types";

const STRIPS = Object.fromEntries(STRIP_PRESETS.map((preset) => [preset.key, preset]));
// The firmware's dead zone reads exactly 0 near level, so the slider snaps there too.
const TILT_SNAP = 0.04;

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
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState("1");
  const [strip, setStrip] = useState(STRIP_PRESETS[0]!.key);
  const [readout, setReadout] = useState<Readout>({ tilt: 0, lastStomp: null, timeMs: 0 });
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
  useEffect(() => simRef.current?.setPaused(paused), [paused]);
  useEffect(() => simRef.current?.setSpeed(Number(speed)), [speed]);
  useEffect(() => simRef.current?.setLayout(recipeRef.current, STRIPS[strip]!.layout), [strip]);

  const stomp = () => {
    simRef.current?.stomp(strength);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 120);
  };

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

        <div className="control playback">
          <button type="button" className={walking ? "button on" : "button"} aria-pressed={walking} onClick={() => setWalking(!walking)}>
            {walking ? "Stop walking" : "Walk"}
          </button>
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
