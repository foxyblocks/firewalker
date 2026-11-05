/**
 * The Audio tab of the remote's Calibrate sheet. Each boot owns its microphone
 * threshold and sensitivity, so tune Left and Right separately while their
 * patterns keep running. BootClient's queue confirms changes from audio-config
 * replies and keeps a drag from being overwritten by an older reading.
 */
import { useEffect, useState } from "react";
import type { BootsStore, Side } from "../core/boots";
import { AUDIO_PROTOCOL_VERSION } from "../core/protocol";
import { LinkDot, PixelSlider } from "./parts";

export function AudioSetup({ store, onBusy, onClose }: {
  store: BootsStore;
  onBusy: (busy: boolean) => void;
  onClose: () => void;
}) {
  const sides = store.targetSides();
  const [side, setSide] = useState<Side | undefined>(
    () => sides.find((candidate) => store.client(candidate)?.getState().link === "online") ?? sides[0],
  );
  const [result, setResult] = useState<string>();
  const client = side ? store.client(side) : undefined;
  const state = client?.getState();
  const online = state?.link === "online";
  const supported = (state?.status?.proto ?? 0) >= AUDIO_PROTOCOL_VERSION;
  const busy = Boolean(online && supported && (state?.audioCalibrating || state?.audio?.calibrating));
  const audio = state?.audio;
  const sensitivity = state?.pending.audioSensitivity ?? audio?.sensitivity ?? 0;
  const name = side ? store.displayName(side) : "this boot";

  useEffect(() => client?.watchAudio(500), [client]);
  useEffect(() => onBusy(busy), [busy, onBusy]);

  const calibrate = async () => {
    if (!client) return;
    setResult(undefined);
    onBusy(true);
    const captured = await client.calibrateAudio();
    setResult(captured.ok ? "Quiet calibrated. You can resume your music." : audioFailure(captured.reason));
    onBusy(false);
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
              disabled={busy}
              onClick={() => {
                setResult(undefined);
                setSide(candidate);
              }}
            >
              <LinkDot link={store.client(candidate)?.getState().link} />
              <span className="tab-name">{store.displayName(candidate)}</span>
            </button>
          ))}
        </div>
      )}
      <p className="sheet-help">
        Pause music and keep {name} still, then calibrate the room's quiet sound.
        Sensitivity sets how easily the bar starts and fills. These settings apply to every audio pattern on {name}.
      </p>
      {!online ? (
        <p className="sheet-help">Waiting for {name} to reconnect.</p>
      ) : !supported ? (
        <p className="sheet-help">Update {name}'s firmware to tune its microphone.</p>
      ) : !audio ? (
        <p className="sheet-help">Reading microphone settings…</p>
      ) : !audio.ready ? (
        <p className="sheet-help">Microphone capture is unavailable on {name}. Reconnect after checking the boot.</p>
      ) : (
        <>
          <div className="strip-cards">
            <section className="strip-card">
              <div className="strip-card-head">
                <h3>Sensitivity</h3>
                <span className="strip-number">{sensitivity}%</span>
              </div>
              <PixelSlider
                label="Audio sensitivity"
                value={sensitivity}
                min={0}
                max={100}
                disabled={busy}
                onStart={() => client?.setDragging(true)}
                onChange={(value) => client?.setAudioSensitivity(value)}
                onEnd={() => client?.setDragging(false)}
              />
            </section>
          </div>
          <button type="button" className="button button-primary button-wide" disabled={busy} onClick={() => void calibrate()}>
            {busy ? "Measuring quiet…" : "Calibrate quiet"}
          </button>
          <span className={`save-line${state?.status?.saveFailed ? " save-failed" : ""}`}>
            {state?.status?.saveFailed ? `Not saved on ${name}` : audio.saved ? `Saved on ${name}` : "Saving"}
          </span>
        </>
      )}
      {result && <p className="sheet-help" role="status">{result}</p>}
      {state?.notice && <p className="sheet-help" role="alert">{audioFailure(state.notice)}</p>}
      <button type="button" className="button button-wide" disabled={busy} onClick={onClose}>Done</button>
    </>
  );
}

function audioFailure(reason?: string): string {
  if (reason === "offline") return "The boot disconnected. Reconnect and try again.";
  if (reason === "firmware-update") return "Update the boot's firmware to calibrate its microphone.";
  if (reason === "audio-unavailable") return "The boot's microphone capture is unavailable.";
  if (reason === "no-answer") return "The boot did not answer. Try again.";
  return "The boot could not complete that change. Try again.";
}
