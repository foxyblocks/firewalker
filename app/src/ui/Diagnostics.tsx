/**
 * The Diagnostics tab of one boot's detail screen: what that boot actually reports, for
 * checking the truth and for debugging. Status lines only go out on a change, so this asks
 * for one each second while it's open, which keeps tilt live, and it reads the saved
 * microphone tuning the same way.
 *
 * Opening Diagnostics starts motion/audio streaming for this boot; leaving turns it off.
 * Debug output leads with Tilt, Stomp, audio volume history, and the audio waveform;
 * Last report follows below. BootClient retains each motion/audio report before rendering
 * so bursts of notifications do not lose stomps or volume changes between renders.
 */

import { useEffect } from "react";
import type { BootClient, BootState } from "../core/boot";
import { patternDisplay } from "../core/patternNames";
import { AUDIO_PROTOCOL_VERSION, AUDIO_WAVEFORM_PROTOCOL_VERSION, PROTOCOL_VERSION, type StatusReply } from "../core/protocol";
import { audioSignalOf, orientationCalibratedOf } from "./bootFacts";
import { AudioWaveform, type AudioWaveformProps } from "./components/AudioWaveform";
import { Fact, FactTable, type Tone } from "./components/Facts";
import { Notice } from "./components/Notice";
import { TiltStrip } from "./components/TiltStrip";
import { StompHistory } from "./components/StompHistory";
import { AudioLevelHistory } from "./components/AudioLevelHistory";

const TILT_REFRESH_MS = 1000;
const AUDIO_REFRESH_MS = 1000;

export function Diagnostics({ client, name }: { client: BootClient; name: string }) {
  const state = client.getState();
  const { status, motion } = state;
  const online = state.link === "online";
  const tilt = motion?.tilt ?? status?.tilt ?? 0;
  const audioView = waveformProps(state);

  useEffect(() => {
    client.setDebug(true);
    const stopTilt = client.watchTilt(TILT_REFRESH_MS);
    const stopAudio = client.watchAudio(AUDIO_REFRESH_MS);
    return () => {
      stopTilt();
      stopAudio();
      client.setDebug(false);
    };
  }, [client]);

  return (
    <div className="stack">
      <section className="panel debug-panel" aria-label="Debug output">
        <h2 className="card-name">Debug output</h2>
        {!online && <p className="help-text help-small">Waiting for this boot to reconnect.</p>}

        <div className="debug-signal">
          <div className="signal-heading"><span className="field-label">Tilt</span><span className="readout">{tilt.toFixed(2)}</span></div>
          <TiltStrip tilt={tilt} />
          <div className="strip-ends"><span>Heel down</span><span>Toe down</span></div>
        </div>

        <div className="debug-signal">
          <span className="field-label">Stomp</span>
          <StompHistory samples={state.motionHistory} live={online && Boolean(motion)} />
        </div>

        <div className="debug-signal">
          <span className="field-label">Audio volume</span>
          <AudioLevelHistory samples={state.audioHistory} status={audioView.status} message={audioView.message} />
        </div>

        <div className="debug-signal">
          <span className="field-label">Audio waveform</span>
          <AudioWaveform {...audioView} />
        </div>

        {motion ? (
          <FactTable tight label="Motion readings">
            <Fact label="Accel" value={`${motion.accel.toFixed(2)} m/s²`} />
            <Fact label="Gyro" value={`${motion.gyro.toFixed(2)} rad/s`} />
            <Fact label="Angle" value={`${motion.angleDeg.toFixed(2)}°`} />
            <Fact label="Last stomp strength" value={motion.strength.toFixed(2)} />
          </FactTable>
        ) : <p className="help-text help-small">Waiting for motion readings.</p>}

      </section>

      <section aria-label="Last reported settings">
        <div className="section-head">
          <span className="section-label">Last report</span>
        </div>
        {status ? (
          <FactTable>
            <Fact label="Pattern" value={status.pattern === "off" ? "Off" : patternDisplay(status.pattern).name} />
            <Fact label="Brightness" value={`${status.brightness} of ${status.maxBrightness}${capText(status.capped)}`} />
            <Fact label="Motion sensor" value={status.sensor === "ok" ? "OK" : "Unavailable"} tone={status.sensor === "ok" ? undefined : "bad"} />
            <Fact {...calibrationFact(status)} />
            <Fact label="Last capture" value={captureText(status.calibration)} />
            <Fact label="Strip" value={`${status.leds} LEDs, toe ${status.toe}, heel ${status.heel}`} />
            <AudioFacts state={state} />
            <Fact label="Saved" value={saveText(status)} tone={status.saveFailed ? "bad" : undefined} />
            <Fact
              label="Firmware"
              value={(status.proto ?? 0) >= PROTOCOL_VERSION ? `Protocol ${status.proto}` : "Update this boot's firmware"}
              tone={(status.proto ?? 0) >= PROTOCOL_VERSION ? undefined : "warn"}
            />
          </FactTable>
        ) : (
          <Notice>Waiting for {name}'s first report.</Notice>
        )}
      </section>
    </div>
  );
}

/** The saved microphone tuning, as quiet rows: it's set from the Remote screen. */
function AudioFacts({ state }: { state: BootState }) {
  const supported = (state.status?.proto ?? 0) >= AUDIO_PROTOCOL_VERSION;
  if (!supported) return <Fact quiet label="Audio" value="Needs a firmware update" />;
  const audio = state.audio;
  if (!audio) return <Fact quiet label="Audio" value="Reading" />;
  return (
    <>
      <Fact quiet label="Quiet threshold" value={audio.calibrating ? "Measuring" : formatFloor(audio.noiseFloor)} />
      <Fact quiet label="Sensitivity" value={`${audio.sensitivity}%`} />
    </>
  );
}

function waveformProps(state: BootState): AudioWaveformProps {
  const signal = audioSignalOf(state);
  if ((state.status?.proto ?? 0) < AUDIO_WAVEFORM_PROTOCOL_VERSION) {
    return { status: "unavailable", message: "Update this boot's firmware for the audio waveform" };
  }
  if (state.audio && !state.audio.ready) return { status: "unavailable", message: "Microphone unavailable" };
  if (!signal) return { status: "waiting", message: "Waiting for the audio signal" };
  if (!signal.ready) return { status: "unavailable", message: "Microphone not ready" };
  return { status: "live", samples: signal.waveform, level: signal.level, rms: signal.rms };
}

const formatFloor = (value: number) => (Number.isInteger(value) ? `${value}` : value.toFixed(2));

/** Says whether the soft cap is on. Firmware from before the cap doesn't report it. */
function capText(capped: boolean | undefined): string {
  if (capped === undefined) return "";
  return capped ? ", capped" : ", cap off";
}

const degrees = (value: number | null | undefined) => (value === null || value === undefined ? "--" : `${value.toFixed(1)}°`);

function calibrationFact(status: StatusReply): { label: string; value: string; tone?: Tone } {
  if (!status.calibrated) return { label: "Neutral", value: "Not set", tone: "warn" };
  const angles = `${degrees(status.heelDeg)}, ${degrees(status.neutralDeg)}, ${degrees(status.toeDeg)}`;
  if (orientationCalibratedOf(status) === false) return { label: "Heel, neutral, toe", value: `${angles}, needs heel or toe`, tone: "warn" };
  return { label: "Heel, neutral, toe", value: angles };
}

function captureText(calibration: string): string {
  if (calibration === "idle") return "None since boot";
  if (calibration === "capturing") return "Capturing";
  if (calibration === "ok") return "OK";
  const words = calibration.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function saveText(status: StatusReply): string {
  if (status.saveFailed) return "Failed";
  if (!status.saved) return "Saving";
  return `Yes, ${status.saves} ${status.saves === 1 ? "write" : "writes"} since boot`;
}
