/**
 * The microphone signal a boot reports: its recent waveform drawn as a line, the current RMS
 * reading, and the level as a percent of the most the boot's audio normalizes to.
 *
 * It only draws samples it's given. With none yet it shows a flat, dashed line and says it's
 * waiting, or that the signal is unavailable, so a picture never stands in for real data.
 */

export type AudioSignalStatus = "live" | "waiting" | "unavailable";

export interface AudioWaveformProps {
  status: AudioSignalStatus;
  /** Samples from -1 to 1, oldest first. */
  samples?: readonly number[];
  /** The normalized level, 0 to 1. */
  level?: number;
  /** The raw RMS the boot measured. */
  rms?: number;
  /** Why the signal is unavailable, or what it's waiting for. */
  message?: string;
}

const WIDTH = 200;
const HEIGHT = 48;

export function AudioWaveform({ status, samples = [], level, rms, message }: AudioWaveformProps) {
  const live = status === "live" && samples.length > 1;
  const percent = level === undefined ? undefined : Math.round(Math.max(0, Math.min(1, level)) * 100);
  const fallback = status === "unavailable" ? "Audio unavailable" : "Waiting for audio";

  return (
    <div className={`waveform waveform-${status}`}>
      <svg
        className="waveform-plot"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={live ? `Audio waveform, ${percent ?? 0}% level` : (message ?? fallback)}
      >
        <line className="waveform-axis" x1="0" x2={WIDTH} y1={HEIGHT / 2} y2={HEIGHT / 2} />
        {live && <polyline className="waveform-line" points={points(samples)} />}
      </svg>
      <div className="waveform-readouts">
        {status === "live" ? (
          <>
            <span>
              <span className="waveform-key">RMS</span> {rms === undefined ? "--" : formatRms(rms)}
            </span>
            <span>
              <span className="waveform-key">Level</span> {percent === undefined ? "--" : `${percent}%`}
            </span>
          </>
        ) : (
          <span className={status === "unavailable" ? "tone-warn" : undefined}>{message ?? fallback}</span>
        )}
      </div>
    </div>
  );
}

function points(samples: readonly number[]): string {
  const last = samples.length - 1;
  return samples
    .map((sample, index) => {
      const value = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
      const x = (index / last) * WIDTH;
      const y = HEIGHT / 2 - value * (HEIGHT / 2 - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Three significant figures, so tiny and large readings both stay legible. */
export function formatRms(rms: number): string {
  if (!Number.isFinite(rms)) return "--";
  if (rms === 0) return "0";
  return Math.abs(rms) >= 100 ? rms.toFixed(0) : rms.toPrecision(3);
}
