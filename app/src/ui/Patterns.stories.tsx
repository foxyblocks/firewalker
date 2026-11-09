/**
 * Patterns: components put together the way the screens use them, with plain props and no
 * boots. Use these as the starting point for a new screen, such as the Studio's, so the
 * pieces keep their spacing and order.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { AudioLevelHistory } from "./components/AudioLevelHistory";
import { AudioWaveform } from "./components/AudioWaveform";
import { Button } from "./components/Button";
import { Fact, FactTable } from "./components/Facts";
import { PixelSlider } from "./components/PixelSlider";
import { StompHistory } from "./components/StompHistory";
import { TiltStrip } from "./components/TiltStrip";
import { Toggle } from "./components/Toggle";

const meta = {
  title: "Patterns",
  parameters: { layout: "padded" },
  decorators: [(Story) => <div className="story-column"><Story /></div>],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const CAP = 96;

/**
 * The Remote's dock: brightness with its cap, then Lights. It stays pinned under the
 * patterns, so a thumb always finds it. The percent is a share of what the boots accept now.
 */
export const Dock: Story = {
  render: function Render() {
    const [capped, setCapped] = useState(true);
    const [level, setLevel] = useState(72);
    const [on, setOn] = useState(true);
    const max = capped ? CAP : 255;
    const shown = Math.min(level, max);
    return (
      <footer className="dock" style={{ borderRadius: "var(--radius-lg)" }}>
        <div className="section-head">
          <span className="section-label">Brightness</span>
          <span className="brightness-head">
            <span className="readout">{Math.round((shown / max) * 100)}%</span>
            <span className="cap-control">
              <span className="cap-label" aria-hidden="true">Cap</span>
              <Toggle on={capped} label="Brightness cap" small onChange={(next) => { setCapped(next); if (next) setLevel(Math.min(level, CAP)); }} />
            </span>
          </span>
        </div>
        <PixelSlider
          label="Brightness"
          value={shown}
          min={1}
          max={max}
          onStart={() => undefined}
          onChange={setLevel}
          onEnd={() => undefined}
          warning={capped ? undefined : { above: CAP, label: "About the brightness cap", message: "Past this line, full white can draw more than USB gives, about 1 A." }}
        />
        <div className="dock-row">
          <div className="dock-card">
            <span className="card-name">Lights {on ? "on" : "off"}</span>
            <Toggle on={on} label="Lights" onChange={setOn} />
          </div>
        </div>
      </footer>
    );
  },
};

/** A section's label with its state on the right, such as where a choice was saved. */
export const SectionHeader: Story = {
  render: () => (
    <>
      <div className="section-head">
        <span className="section-label">Pattern</span>
        <span className="save-line"><span className="dot dot-good" aria-hidden="true" />Saved on Left and Right</span>
      </div>
      <div className="section-head">
        <span className="section-label">Pattern</span>
        <span className="save-line"><span className="dot dot-wait" aria-hidden="true" />Saving</span>
      </div>
      <div className="section-head">
        <span className="section-label">Pattern</span>
        <span className="save-line save-failed">Not saved</span>
      </div>
    </>
  ),
};

/** Two actions that open sheets, side by side, each with a hint under its name. */
export const SetupActions: Story = {
  render: () => (
    <section aria-label="Calibrate">
      <div className="section-head">
        <span className="section-label">Calibrate</span>
        <span className="card-hint tone-warn">Neutral not set</span>
      </div>
      <div className="setup-actions">
        <Button className="setup-action"><span>Poses</span><span className="card-hint">Neutral, heel &amp; toe</span></Button>
        <Button className="setup-action"><span>Strip</span><span className="card-hint">LED count &amp; positions</span></Button>
      </div>
    </section>
  ),
};

const motion = Array.from({ length: 76 }, (_, index) => ({
  time: index * 200,
  peak: index === 22 ? 27 : index === 53 ? 34 : 9.8 + Math.sin(index * 0.7) * 0.4,
  stomp: index === 22 || index === 53,
}));
const audio = Array.from({ length: 76 }, (_, index) => ({
  time: index * 200,
  level: Math.min(1, 0.12 + Math.max(0, Math.sin(index * 0.24)) ** 4 * 0.76),
}));
const wave = Array.from({ length: 64 }, (_, index) => 0.4 * Math.sin((index / 64) * 2 * Math.PI * 3) + 0.12 * Math.sin((index / 64) * 2 * Math.PI * 11));

/**
 * Diagnostics' Debug output: signals first, each with a field label, then the raw numbers.
 * Graphs share one 15-second window, so the Studio can line two boots up side by side.
 */
export const DebugOutput: Story = {
  render: () => (
    <section className="panel debug-panel" aria-label="Debug output">
      <h2 className="card-name">Debug output</h2>
      <div className="debug-signal">
        <div className="signal-heading"><span className="field-label">Tilt</span><span className="readout">0.35</span></div>
        <TiltStrip tilt={0.35} />
        <div className="strip-ends"><span>Heel down</span><span>Toe down</span></div>
      </div>
      <div className="debug-signal">
        <span className="field-label">Stomp</span>
        <StompHistory samples={motion} live />
      </div>
      <div className="debug-signal">
        <span className="field-label">Audio volume</span>
        <AudioLevelHistory samples={audio} status="live" />
      </div>
      <div className="debug-signal">
        <span className="field-label">Audio waveform</span>
        <AudioWaveform status="live" samples={wave} level={0.42} rms={24.8} />
      </div>
      <FactTable tight label="Motion readings">
        <Fact label="Accel" value="9.88 m/s²" />
        <Fact label="Gyro" value="0.03 rad/s" />
        <Fact label="Angle" value="5.40°" />
        <Fact label="Last stomp strength" value="0.41" />
      </FactTable>
    </section>
  ),
};
