// The simulator's audio toolbar. Source selection is separate from Listen so
// browsing the dropdown never opens a permission prompt. Leaving the designer
// ends the capture, even if the browser is still waiting for a source. The stable
// onLevel callback feeds Simulation directly, so metering doesn't rerender the editor.

import { useEffect, useRef, useState } from "react";

import { SILENCE, startAudioCapture, type AudioSource } from "../sim/audioCapture";

type Status = "off" | "connecting" | "live";

export function AudioMonitor({ onLevel }: { onLevel: (level: number) => void }) {
  const [source, setSource] = useState<AudioSource>("microphone");
  const [status, setStatus] = useState<Status>("off");
  const [reading, setReading] = useState(SILENCE);
  const [message, setMessage] = useState("");
  const capture = useRef<ReturnType<typeof startAudioCapture> | null>(null);

  useEffect(() => () => {
    capture.current?.stop();
    capture.current = null;
    onLevel(0);
  }, [onLevel]);
  useEffect(() => {
    if (status !== "live") return;
    const timer = window.setInterval(() => {
      if (!capture.current) return;
      const next = capture.current.read();
      setReading(next);
      onLevel(next.level);
    }, 50);
    return () => window.clearInterval(timer);
  }, [status, onLevel]);

  function stop() {
    capture.current?.stop();
    capture.current = null;
    setStatus("off");
    setReading(SILENCE);
    onLevel(0);
    setMessage("");
  }

  async function listen() {
    setStatus("connecting");
    setMessage(source === "computer" ? "Choose a tab or screen and enable Share audio." : "");
    let session: ReturnType<typeof startAudioCapture> | undefined;
    try {
      session = startAudioCapture(source, () => {
        if (capture.current !== session) return;
        stop();
        setMessage("Audio sharing ended.");
      });
      capture.current = session;
      await session.ready;
      if (capture.current !== session) return;
      setStatus("live");
      setMessage("");
    } catch (error) {
      if (session && capture.current !== session) return;
      stop();
      setMessage(error instanceof Error ? error.message : "Couldn't start audio capture.");
    }
  }

  const percent = Math.round(reading.level * 100);
  const statusText = status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Off";

  return (
    <div
      className="audio-monitor"
      onKeyDown={(event) => {
        // Keep Space on a focused audio control from also stomping the boot.
        if (event.code === "Space") event.stopPropagation();
      }}
    >
      <div className="audio-monitor-controls">
        <label className="field-label" htmlFor="sim-audio-source">Audio source</label>
        <select
          id="sim-audio-source"
          value={source}
          onChange={(event) => {
            stop();
            setSource(event.target.value === "computer" ? "computer" : "microphone");
          }}
        >
          <option value="microphone">Microphone</option>
          <option value="computer">Computer audio</option>
        </select>
        <button
          type="button"
          className={status === "live" ? "button small on" : "button small"}
          onClick={status === "off" ? () => void listen() : stop}
        >
          {status === "off" ? "Listen" : "Stop"}
        </button>
      </div>
      <div className="audio-monitor-signal" data-status={status}>
        <span className="audio-monitor-status" role="status">{statusText}</span>
        <div
          className="audio-monitor-spectrum"
          role="meter"
          aria-label="Audio input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          {reading.bands.map((value, index) => (
            <span key={index} aria-hidden="true">
              <i style={{ transform: `scaleY(${value})` }} />
            </span>
          ))}
        </div>
        <span className="readout" aria-hidden="true">{percent}%</span>
      </div>
      {message && <p className="audio-monitor-message" role="status">{message}</p>}
    </div>
  );
}
