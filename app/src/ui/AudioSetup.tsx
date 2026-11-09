/**
 * Microphone tuning on the Remote screen, just above brightness. Each boot owns its own
 * quiet threshold and sensitivity, and its audio patterns keep running while you tune them.
 * With Both chosen, the panel picks one boot's microphone at a time, since the two can differ.
 * Pattern, brightness, and power still go to both.
 *
 * It's a single line until opened, so the dock stays short on a small phone. Open, it watches
 * that boot's audio-config replies. BootClient's queue confirms changes from those replies and
 * keeps a drag from being overwritten by an older reading.
 */

import { useEffect, useState } from "react";
import type { BootsStore, Side } from "../core/boots";
import { AUDIO_PROTOCOL_VERSION } from "../core/protocol";
import { Button, ChevronIcon } from "./components/Button";
import { Notice } from "./components/Notice";
import { PixelSlider } from "./components/PixelSlider";
import { Segmented } from "./components/Segmented";
import { LinkDot } from "./parts";

const AUDIO_REFRESH_MS = 500;

export function AudioPanel({ store }: { store: BootsStore }) {
  const sides = store.targetSides();
  const [picked, setPicked] = useState<Side>();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ side: Side; tone: "info" | "bad"; text: string }>();
  const online = (candidate: Side) => store.client(candidate)?.getState().link === "online";
  const side =
    picked && sides.includes(picked) ? picked : (sides.find(online) ?? sides[0]);
  const client = side ? store.client(side) : undefined;
  const state = client?.getState();
  const isOnline = state?.link === "online";
  const supported = (state?.status?.proto ?? 0) >= AUDIO_PROTOCOL_VERSION;
  const audio = state?.audio;
  // Only a capture this client is awaiting locks the boot choice. A cached firmware
  // progress line can outlive a timeout, so it mustn't trap the panel.
  const busy = Boolean(isOnline && supported && state?.audioCalibrating);
  const measuring = busy || Boolean(isOnline && supported && audio?.calibrating);
  const sensitivity = state?.pending.audioSensitivity ?? audio?.sensitivity;
  const name = side ? store.displayName(side) : "this boot";
  const shared = sides.length > 1;

  useEffect(() => (open && client ? client.watchAudio(AUDIO_REFRESH_MS) : undefined), [open, client]);

  if (!side) return null;

  const calibrate = async () => {
    if (!client) return;
    const forSide = side;
    setResult(undefined);
    const captured = await client.calibrateAudio();
    setResult({
      side: forSide,
      tone: captured.ok ? "info" : "bad",
      text: captured.ok ? "Quiet calibrated. You can resume your music." : audioFailure(captured.reason),
    });
  };

  const summary = !isOnline
    ? "Offline"
    : !supported
      ? "Needs update"
      : !audio
        ? "Reading"
        : !audio.ready
          ? "Unavailable"
          : measuring
            ? "Measuring quiet"
            : `${sensitivity}%`;

  return (
    <section className={`audio-panel${open ? " audio-panel-open" : ""}`} aria-label="Audio">
      <button
        type="button"
        className="audio-panel-head"
        aria-expanded={open}
        aria-controls="audio-panel-body"
        onClick={() => setOpen((shown) => !shown)}
      >
        <span className="section-label">Audio</span>
        <span className="audio-panel-summary">
          {shared && <span className="audio-panel-who">{name} mic</span>}
          <span className="readout">{summary}</span>
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <div id="audio-panel-body" className="audio-panel-body">
          {shared && (
            <Segmented<Side>
              label="Which boot's microphone"
              kind="choice"
              value={side}
              disabled={busy}
              onChange={(next) => {
                setPicked(next);
              }}
              options={sides.map((candidate) => ({
                value: candidate,
                label: store.displayName(candidate),
                lead: <LinkDot link={store.client(candidate)?.getState().link} />,
                dimmed: !online(candidate),
              }))}
            />
          )}
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
              <div className="audio-slider">
                <div className="section-head">
                  <span className="field-label">Sensitivity</span>
                  <span className="readout">{sensitivity}%</span>
                </div>
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
              </div>
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
          {result && result.side === side && <Notice tone={result.tone}>{result.text}</Notice>}
        </div>
      )}
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
