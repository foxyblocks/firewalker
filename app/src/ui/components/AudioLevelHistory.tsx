/**
 * The boot's reported audio volume over the last 15 seconds, on a fixed 0–100%
 * scale. Diagnostics places this below Stomp for comparing their timing, followed
 * by AudioWaveform for the shape of the latest microphone block. History comes
 * from BootClient; this component only draws supplied readings.
 */
import { AUDIO_HISTORY_MS, type AudioHistoryPoint } from "../../core/audioHistory";
import type { AudioSignalStatus } from "./AudioWaveform";

const WIDTH = 320;
const HEIGHT = 80;
const PAD = 6;

export interface AudioLevelHistoryProps {
  samples: readonly AudioHistoryPoint[];
  status: AudioSignalStatus;
  message?: string;
}

export function AudioLevelHistory({ samples, status, message }: AudioLevelHistoryProps) {
  const last = status === "live" ? samples.at(-1) : undefined;
  const end = last?.time ?? 0;
  const readings = last ? samples.filter((point) => point.time >= end - AUDIO_HISTORY_MS) : [];
  const x = (time: number) => PAD + ((time - (end - AUDIO_HISTORY_MS)) / AUDIO_HISTORY_MS) * (WIDTH - PAD * 2);
  const y = (level: number) => HEIGHT - PAD - Math.max(0, Math.min(1, level)) * (HEIGHT - PAD * 2);
  const points = readings.map((point) => `${x(point.time).toFixed(1)},${y(point.level).toFixed(1)}`).join(" ");
  const percent = last ? Math.round(last.level * 100) : undefined;
  const fallback = message ?? (status === "unavailable" ? "Audio unavailable" : "Waiting for audio");

  return (
    <div className="signal-history">
      <svg className="history-plot" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={last ? `Audio volume over 15 seconds, ${percent}% current level` : fallback}>
        <line className="waveform-axis" x1={PAD} x2={WIDTH - PAD} y1={y(.5)} y2={y(.5)} />
        {readings.length > 1 && <polyline className="waveform-line" points={points} />}
        {last && <circle cx={x(last.time)} cy={y(last.level)} r="2" fill="var(--ember)" />}
        <text className="history-scale" x={WIDTH - PAD} y="12" textAnchor="end">100%</text>
        <text className="history-scale" x={WIDTH - PAD} y={HEIGHT - PAD} textAnchor="end">0%</text>
      </svg>
      <div className="waveform-readouts">
        <span className={status === "unavailable" ? "tone-warn" : undefined}>{last ? `${percent}% of max volume` : fallback}</span>
        <span>15s → now</span>
      </div>
    </div>
  );
}
