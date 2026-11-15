/**
 * Microphone tuning, in the Remote's Audio drawer. Each boot owns its own quiet threshold and
 * sensitivity, and its audio patterns keep running while you tune them. The drawer stacks one
 * block per chosen boot, so with Both chosen you tune Left and Right side by side. Pattern,
 * brightness, and power still go to every chosen boot at once.
 *
 * A block only exists while the drawer is open, and it watches its boot's audio-config replies
 * meanwhile. BootClient's queue confirms changes from those replies and keeps a drag from being
 * overwritten by an older reading. `audioSummary` is the bar's one-line reading of the same.
 */

import { useEffect, useState } from "react";
import type { BootState } from "../core/boot";
import type { BootsStore, Side } from "../core/boots";
import { AUDIO_PROTOCOL_VERSION } from "../core/protocol";
import { Button } from "./components/Button";
import { Notice } from "./components/Notice";
import { PixelSlider } from "./components/PixelSlider";
import { LinkDot } from "./parts";

const AUDIO_REFRESH_MS = 500;

/** Every chosen boot's microphone, one block each. */
export function AudioControls({ store }: { store: BootsStore }) {
  const sides = store.targetSides();
  return (
    <div className="mic-list">
      {sides.map((side) => (
        <MicControls key={side} store={store} side={side} />
      ))}
    </div>
  );
}

/** What the bar shows for the chosen boots' microphones, such as "65%" or "65 · 40%". */
export function audioSummary(store: BootsStore): string {
  const readings = store.targetSides().map((side) => micReading(store.client(side)?.getState()));
  if (readings.length === 0) return "--";
  const numbers = readings.filter((reading): reading is number => typeof reading === "number");
  if (numbers.length === readings.length) {
    return new Set(numbers).size === 1 ? `${numbers[0]}%` : `${numbers.join(" · ")}%`;
  }
  if (readings.length === 1) return readings[0] as string;
  return readings.map((reading) => (typeof reading === "number" ? `${reading}%` : "--")).join(" · ");
}

/** A boot's sensitivity, or a word for why there isn't one. */
function micReading(state: BootState | undefined): number | string {
  if (state?.link !== "online") return "Offline";
  if ((state.status?.proto ?? 0) < AUDIO_PROTOCOL_VERSION) return "Update";
  if (!state.audio) return "...";
  if (!state.audio.ready) return "No mic";
  if (state.audioCalibrating || state.audio.calibrating) return "Quiet...";
  return state.pending.audioSensitivity ?? state.audio.sensitivity;
}

function MicControls({ store, side }: { store: BootsStore; side: Side }) {
  const [result, setResult] = useState<{ tone: "info" | "bad"; text: string }>();
  const client = store.client(side);
  const state = client?.getState();
  const isOnline = state?.link === "online";
  const supported = (state?.status?.proto ?? 0) >= AUDIO_PROTOCOL_VERSION;
  const audio = state?.audio;
  const measuring = Boolean(isOnline && supported && (state?.audioCalibrating || audio?.calibrating));
  const sensitivity = state?.pending.audioSensitivity ?? audio?.sensitivity;
  const name = store.displayName(side);
  const reading = micReading(state);

  useEffect(() => (client ? client.watchAudio(AUDIO_REFRESH_MS) : undefined), [client]);

  const calibrate = async () => {
    if (!client) return;
    setResult(undefined);
    const captured = await client.calibrateAudio();
    setResult({
      tone: captured.ok ? "info" : "bad",
      text: captured.ok ? "Quiet calibrated. You can resume your music." : audioFailure(captured.reason),
    });
  };

  return (
    <section className="mic" aria-label={`${name} microphone`}>
      <div className="mic-head">
        <span className="mic-name">
          <LinkDot link={state?.link} />
          {name}
        </span>
        <span className="readout">{typeof reading === "number" ? `${reading}%` : reading}</span>
      </div>
      {!isOnline ? (
        <Notice>Waiting for {name} to reconnect.</Notice>
      ) : !supported ? (
        <Notice tone="warn">Update {name}'s firmware to tune its microphone.</Notice>
      ) : !audio ? (
        <Notice>Reading {name}'s microphone settings.</Notice>
      ) : !audio.ready ? (
        <Notice tone="warn">{name}'s microphone capture is unavailable. Check the boot, then reconnect.</Notice>
      ) : (
        <>
          <PixelSlider
            label={`${name} audio sensitivity`}
            value={sensitivity ?? 0}
            min={0}
            max={100}
            disabled={measuring}
            onStart={() => client?.setDragging(true)}
            onChange={(value) => client?.setAudioSensitivity(value)}
            onEnd={() => client?.setDragging(false)}
          />
          <div className="audio-quiet">
            <Button className="button-compact" busy={measuring} onClick={() => void calibrate()}>
              {measuring ? "Measuring" : "Calibrate quiet"}
            </Button>
            <span className="audio-quiet-notes">
              <span className="help-text help-small">Pause music, hold still.</span>
              <span className={`save-line${state?.status?.saveFailed ? " save-failed" : ""}`}>
                {state?.status?.saveFailed
                  ? `Not saved on ${name}`
                  : audio.saved
                    ? `Quiet ${formatFloor(audio.noiseFloor)}, saved`
                    : "Saving"}
              </span>
            </span>
          </div>
        </>
      )}
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
    </section>
  );
}

const formatFloor = (value: number) => (Number.isInteger(value) ? `${value}` : value.toFixed(2));

function audioFailure(reason?: string): string {
  if (reason === "offline") return "The boot disconnected. Reconnect and try again.";
  if (reason === "firmware-update") return "Update the boot's firmware to calibrate its microphone.";
  if (reason === "audio-unavailable") return "The boot's microphone capture is unavailable.";
  if (reason === "no-answer") return "The boot didn't answer. Try again.";
  if (reason === "already-capturing") return "It's still measuring. Give it a second.";
  return "The boot couldn't complete that change. Try again.";
}
