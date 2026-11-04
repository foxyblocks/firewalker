/**
 * The Strip tab of the Calibrate sheet: tells one boot how long its strip is and which
 * pixels sit at the toe and heel, while you look at the strip itself. Each boot saves its
 * own, because a cut length and a mount can differ, so with two boots you set them one at
 * a time.
 *
 * Whichever slider you last touched is what the strip previews: the LED count fills the
 * ring in blue, so you stop when the blue reaches the end, and toe and heel each light one
 * pixel, in yellow and purple, that you walk to the right spot. A slider follows your
 * finger, and the minus and plus buttons land on the exact pixel.
 *
 * The boot holds the truth (`shownStrip`), and the rules for where a slider can land are in
 * core/stripSetup.ts. BootClient keeps the preview up for as long as this tab asks for one,
 * and the boot drops it by itself if the phone goes away.
 */

import { useEffect, useState } from "react";
import type { BootsStore, Side } from "../core/boots";
import type { StripSetting } from "../core/protocol";
import { dragTo, nudge, shownStrip, sliderRange, type StripValues } from "../core/stripSetup";
import { LinkDot, PixelSlider, type PixelSliderShape, type PixelTone } from "./parts";

const SLIDERS: {
  setting: StripSetting;
  name: string;
  tone: PixelTone;
  shape: PixelSliderShape;
  hint: string;
}[] = [
  {
    setting: "leds",
    name: "LED count",
    tone: "blue",
    shape: "fill",
    hint: "Slide until the blue reaches the end of the strip.",
  },
  {
    setting: "toe",
    name: "Toe",
    tone: "yellow",
    shape: "point",
    hint: "Move the yellow pixel to the tip of your toe.",
  },
  {
    setting: "heel",
    name: "Heel",
    tone: "purple",
    shape: "point",
    hint: "Move the purple pixel to the back of your heel.",
  },
];

export function StripSetup({ store, onClose }: { store: BootsStore; onClose: () => void }) {
  const sides = store.targetSides();
  const [side, setSide] = useState<Side | undefined>(
    () => sides.find((candidate) => store.client(candidate)?.getState().link === "online") ?? sides[0],
  );
  const [active, setActive] = useState<StripSetting>("leds");
  const client = side ? store.client(side) : undefined;
  const state = client?.getState();
  const online = state?.link === "online";
  const values = state ? shownStrip(state) : undefined;

  // Two effects, so that moving between sliders changes the preview without flickering back
  // through the pattern. Only leaving this boot, or this tab, turns the preview off.
  useEffect(() => {
    client?.setStripPreview(active);
  }, [client, active]);
  useEffect(() => () => client?.setStripPreview("off"), [client]);

  const change = (setting: StripSetting, value: number) => {
    if (values && value !== values[setting]) client?.setStrip(setting, value);
  };

  return (
    <>
      {sides.length > 1 && (
        <div className="tabs tabs-sheet" role="tablist" aria-label="Boot">
          {sides.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={candidate === side}
              className={`tab${candidate === side ? " tab-on" : ""}`}
              onClick={() => setSide(candidate)}
            >
              <LinkDot link={store.client(candidate)?.getState().link} />
              <span className="tab-name">{store.displayName(candidate)}</span>
            </button>
          ))}
        </div>
      )}

      {values && side ? (
        <>
          <p className="sheet-help strip-hint">{SLIDERS.find(({ setting }) => setting === active)?.hint}</p>
          <div className="strip-cards">
            {SLIDERS.map((slider) => (
              <SliderCard
                key={slider.setting}
                {...slider}
                values={values}
                active={slider.setting === active}
                disabled={!online}
                onActive={() => setActive(slider.setting)}
                onDragging={(dragging) => client?.setDragging(dragging)}
                onChange={(value) => change(slider.setting, value)}
              />
            ))}
          </div>
          <SaveNote store={store} side={side} online={online} />
        </>
      ) : (
        <p className="sheet-help">
          {online
            ? `${side ? store.displayName(side) : "This boot"} needs a firmware update before it can set its strip.`
            : "Waiting for this boot to reconnect."}
        </p>
      )}

      <button type="button" className="button button-primary button-wide" onClick={onClose}>
        Done
      </button>
    </>
  );
}

function SliderCard({
  setting,
  name,
  tone,
  shape,
  values,
  active,
  disabled,
  onActive,
  onDragging,
  onChange,
}: {
  setting: StripSetting;
  name: string;
  tone: PixelTone;
  shape: PixelSliderShape;
  values: StripValues;
  active: boolean;
  disabled: boolean;
  onActive: () => void;
  onDragging: (dragging: boolean) => void;
  onChange: (value: number) => void;
}) {
  const { min, max } = sliderRange(setting, values);
  // A marker the count was just cut below shows at the end until the boot reports it moved.
  const value = Math.min(values[setting], max);
  const step = (direction: 1 | -1) => {
    onActive();
    onChange(nudge(setting, direction, values));
  };

  return (
    <div className={`strip-card led-${tone}${active ? " strip-card-on" : ""}`} onPointerDown={onActive}>
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
        onStart={() => {
          onActive();
          onDragging(true);
        }}
        onChange={(wanted) => onChange(dragTo(setting, wanted, values))}
        onStep={step}
        onEnd={() => onDragging(false)}
      />
    </div>
  );
}

function SaveNote({ store, side, online }: { store: BootsStore; side: Side; online: boolean }) {
  const status = store.client(side)?.getState().status;
  const name = store.displayName(side);
  if (!online) return <span className="save-line">Reconnecting to {name}</span>;
  if (status?.saveFailed) return <span className="save-line save-failed">Not saved on {name}</span>;
  return (
    <span className="save-line">
      <span className={`dot ${status?.saved ? "dot-good" : "dot-wait"}`} aria-hidden="true" />
      {status?.saved ? `Saved on ${name}` : "Saving"}
    </span>
  );
}
