/**
 * What one boot actually reports, for checking the truth and for debugging. Status lines
 * only go out on a change, so this screen asks for one each second while it's open, which
 * keeps tilt live. The debug switch adds motion lines five times a second. Debug stays on
 * in the boot after a disconnect, so leaving this screen always turns it off.
 */

import { useEffect, useState } from "react";
import type { BootState } from "../core/boot";
import { SIDE_NAMES, type BootsStore, type Side } from "../core/boots";
import { patternDisplay } from "../core/patternNames";
import { PROTOCOL_VERSION } from "../core/protocol";
import { LinkDot, TiltStrip, Toggle } from "./parts";

const TILT_REFRESH_MS = 1000;

export function Status({ store, onBack }: { store: BootsStore; onBack: () => void }) {
  const sides = store.sides();
  const [side, setSide] = useState<Side | undefined>(store.target === "both" ? sides[0] : store.target);
  const client = side ? store.client(side) : undefined;

  useEffect(() => {
    if (!client) return;
    const stopWatching = client.watchTilt(TILT_REFRESH_MS);
    return () => {
      stopWatching();
      if (client.getState().status?.debug || client.getState().pending.debug) client.setDebug(false);
    };
  }, [client]);

  return (
    <>
      <header className="topbar">
        <button type="button" className="link" onClick={onBack}>
          ‹ Remote
        </button>
        <h1 className="screen-title">Status</h1>
      </header>

      <div className="tabs" role="tablist">
        {sides.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={candidate === side}
            className={`tab${candidate === side ? " tab-on" : ""}`}
            onClick={() => setSide(candidate)}
          >
            <span className="tab-name">{store.displayName(candidate)}</span>
          </button>
        ))}
      </div>

      <main className="scroll">
        {side && client ? (
          <BootDetails key={side} store={store} side={side} state={client.getState()} onForgotten={onBack} />
        ) : (
          <p className="empty">No boots yet. Add one from the Boots screen.</p>
        )}
      </main>
    </>
  );
}

function BootDetails({
  store,
  side,
  state,
  onForgotten,
}: {
  store: BootsStore;
  side: Side;
  state: BootState;
  onForgotten: () => void;
}) {
  const client = store.client(side)!;
  const { status, motion } = state;
  const online = state.link === "online";
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(store.known(side)?.nickname ?? "");
  const [confirmingForget, setConfirmingForget] = useState(false);
  const debugOn = state.pending.debug ?? status?.debug ?? false;
  const tilt = motion?.tilt ?? status?.tilt ?? 0;

  const saveName = () => {
    store.rename(side, draftName);
    setRenaming(false);
  };

  return (
    <>
      <div className="boot-head">
        <span className="card-name">{store.bootName(side)}</span>
        <span className="save-line">
          <LinkDot link={state.link} />
          {state.link === "online"
            ? "Connected"
            : state.link === "sleeping"
              ? "Paused — last reported settings"
              : state.link === "connecting"
                ? "Connecting"
                : state.link === "needs-access"
                  ? "Needs reconnecting"
                  : "Reconnecting"}
        </span>
      </div>

      {status ? (
        <dl className="facts">
          <Fact label="Pattern" value={status.pattern === "off" ? "Off" : patternDisplay(status.pattern).name} />
          <Fact label="Brightness" value={`${status.brightness} of ${status.maxBrightness}`} />
          <Fact label="Motion sensor" value={status.sensor === "ok" ? "OK" : "Unavailable"} tone={status.sensor === "ok" ? undefined : "bad"} />
          <Fact {...calibrationFact(status)} />
          <Fact label="Last capture" value={captureText(status.calibration)} />
          <Fact label="Strip" value={`${status.leds} LEDs, toe ${status.toe}, heel ${status.heel}`} />
          <Fact label="Saved" value={saveText(status)} tone={status.saveFailed ? "bad" : undefined} />
          <Fact
            label="Firmware"
            value={(status.proto ?? 0) >= PROTOCOL_VERSION ? `Protocol ${status.proto}` : "Update this boot's firmware"}
            tone={(status.proto ?? 0) >= PROTOCOL_VERSION ? undefined : "warn"}
          />
        </dl>
      ) : (
        <p className="empty">Waiting for this boot's first report.</p>
      )}

      <section className="panel">
        <div className="section-head">
          <span className="section-label">Tilt</span>
          <span className="readout">{tilt.toFixed(2)}</span>
        </div>
        <TiltStrip tilt={tilt} />
        <div className="strip-ends">
          <span>Heel down</span>
          <span>Toe down</span>
        </div>
      </section>

      <section className="panel">
        <div className="row">
          <span className="card-name">Debug output</span>
          <Toggle on={debugOn} label="Debug output" disabled={!online} onChange={(on) => client.setDebug(on)} />
        </div>
        {debugOn && motion && (
          <dl className="facts facts-tight">
            <Fact label="Accel" value={`${motion.accel.toFixed(2)} m/s²`} />
            <Fact label="Peak" value={`${motion.accelPeak.toFixed(2)} m/s²`} />
            <Fact label="Gyro" value={`${motion.gyro.toFixed(2)} rad/s`} />
            <Fact label="Angle" value={`${motion.angleDeg.toFixed(2)}°`} />
            <Fact label="Stomp strength" value={motion.strength.toFixed(2)} />
            <Fact label="Stomp" value={motion.stomp ? "Yes" : "No"} />
          </dl>
        )}
      </section>

      {renaming ? (
        <form
          className="rename"
          onSubmit={(event) => {
            event.preventDefault();
            saveName();
          }}
        >
          <input
            className="input"
            value={draftName}
            maxLength={12}
            autoFocus
            placeholder={SIDE_NAMES[side]}
            aria-label="Boot name"
            onChange={(event) => setDraftName(event.target.value)}
          />
          <button type="submit" className="button button-primary">
            Save
          </button>
        </form>
      ) : (
        <div className="actions">
          <button type="button" className="button" disabled={!online} onClick={() => client.blink()}>
            Blink
          </button>
          <button type="button" className="button" onClick={() => setRenaming(true)}>
            Rename
          </button>
          <button
            type="button"
            className={`button${confirmingForget ? " button-danger" : ""}`}
            onClick={() => {
              if (!confirmingForget) {
                setConfirmingForget(true);
                return;
              }
              store.forget(side);
              onForgotten();
            }}
          >
            {confirmingForget ? "Tap to forget" : "Forget"}
          </button>
        </div>
      )}
    </>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "bad" | "warn" }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd className={tone ? `tone-${tone}` : undefined}>{value}</dd>
    </div>
  );
}

const degrees = (value: number | null | undefined) => (value === null || value === undefined ? "--" : `${value.toFixed(1)}°`);

function calibrationFact(status: NonNullable<BootState["status"]>) {
  if (!status.calibrated) return { label: "Neutral", value: "Not set", tone: "warn" as const };
  return {
    label: "Heel, neutral, toe",
    value: `${degrees(status.heelDeg)}, ${degrees(status.neutralDeg)}, ${degrees(status.toeDeg)}`,
  };
}

function captureText(calibration: string): string {
  if (calibration === "idle") return "None since boot";
  if (calibration === "capturing") return "Capturing";
  if (calibration === "ok") return "OK";
  const words = calibration.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function saveText(status: NonNullable<BootState["status"]>): string {
  if (status.saveFailed) return "Failed";
  if (!status.saved) return "Saving";
  return `Yes, ${status.saves} ${status.saves === 1 ? "write" : "writes"} since boot`;
}
