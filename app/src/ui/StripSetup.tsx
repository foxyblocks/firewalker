/**
 * The Strip tab of a boot's Configuration: tells that one boot how long its strip is and which
 * pixels sit at the toe and heel, while you look at the strip itself. Each boot saves its own,
 * because a cut length and a mount can differ.
 *
 * For as long as this tab is open, the strip shows the whole layout at once: the ring in
 * blue, with one yellow pixel at the toe and one purple pixel at the heel. So you stop the
 * LED count when the blue reaches the end of the strip, and walk each marker to the right
 * spot. A slider follows your finger, and the minus and plus buttons land on the exact pixel.
 *
 * The boot holds the truth (`shownStrip`), and the rules for where a slider can land are in
 * core/stripSetup.ts. BootClient keeps the preview up for as long as this tab asks for one,
 * and the boot drops it by itself if the phone goes away.
 */

import { useEffect } from "react";
import type { BootClient } from "../core/boot";
import type { StripSetting } from "../core/protocol";
import { dragTo, nudge, shownStrip, sliderRange, type StripValues } from "../core/stripSetup";
import { Notice } from "./components/Notice";
import { PixelSlider, type PixelSliderShape, type PixelTone } from "./components/PixelSlider";

const SLIDERS: { setting: StripSetting; name: string; tone: PixelTone; shape: PixelSliderShape }[] = [
  { setting: "leds", name: "LED count", tone: "blue", shape: "fill" },
  { setting: "toe", name: "Toe", tone: "yellow", shape: "point" },
  { setting: "heel", name: "Heel", tone: "purple", shape: "point" },
];

export function StripSetup({ client, name }: { client: BootClient; name: string }) {
  const state = client.getState();
  const online = state.link === "online";
  const values = shownStrip(state);

  // The strip shows its layout for as long as this tab is on this boot.
  useEffect(() => {
    client.setStripPreview(true);
    return () => client.setStripPreview(false);
  }, [client]);

  const change = (setting: StripSetting, value: number) => {
    if (values && value !== values[setting]) client.setStrip(setting, value);
  };

  if (!values) {
    return online ? (
      <Notice tone="warn">{name} needs a firmware update before it can set its strip.</Notice>
    ) : (
      <Notice>Waiting for {name} to reconnect.</Notice>
    );
  }

  return (
    <div className="stack">
      <p className="help-text">
        Slide until the blue reaches the end of the strip. Then move yellow to the tip of your toe, and purple to the back of
        your heel.
      </p>
      <div className="strip-cards">
        {SLIDERS.map((slider) => (
          <SliderCard
            key={slider.setting}
            {...slider}
            values={values}
            disabled={!online}
            onDragging={(dragging) => client.setDragging(dragging)}
            onChange={(value) => change(slider.setting, value)}
          />
        ))}
      </div>
      <SaveNote client={client} name={name} />
    </div>
  );
}

function SliderCard({
  setting,
  name,
  tone,
  shape,
  values,
  disabled,
  onDragging,
  onChange,
}: {
  setting: StripSetting;
  name: string;
  tone: PixelTone;
  shape: PixelSliderShape;
  values: StripValues;
  disabled: boolean;
  onDragging: (dragging: boolean) => void;
  onChange: (value: number) => void;
}) {
  const { min, max } = sliderRange(setting, values);
  // A marker the count was just cut below shows at the end until the boot reports it moved.
  const value = Math.min(values[setting], max);
  const step = (direction: 1 | -1) => onChange(nudge(setting, direction, values));

  return (
    <div className={`strip-card led-${tone}`}>
      <div className="strip-card-head">
        <span className="card-name">{name}</span>
        <div className="stepper">
          <button type="button" className="step-button" disabled={disabled} aria-label={`${name} down one`} onClick={() => step(-1)}>
            −
          </button>
          <span className="strip-number">{value}</span>
          <button type="button" className="step-button" disabled={disabled} aria-label={`${name} up one`} onClick={() => step(1)}>
            +
          </button>
        </div>
      </div>
      <PixelSlider
        label={name}
        value={value}
        min={min}
        max={max}
        shape={shape}
        disabled={disabled}
        onStart={() => onDragging(true)}
        onChange={(wanted) => onChange(dragTo(setting, wanted, values))}
        onStep={step}
        onEnd={() => onDragging(false)}
      />
    </div>
  );
}

function SaveNote({ client, name }: { client: BootClient; name: string }) {
  const state = client.getState();
  const status = state.status;
  if (state.link !== "online") return <span className="save-line">Reconnecting to {name}</span>;
  if (status?.saveFailed) return <span className="save-line save-failed">Not saved on {name}</span>;
  return (
    <span className="save-line">
      <span className={`dot ${status?.saved ? "dot-good" : "dot-wait"}`} aria-hidden="true" />
      {status?.saved ? `Saved on ${name}` : "Saving"}
    </span>
  );
}
