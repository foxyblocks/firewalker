/**
 * Reported acceleration peaks over the last 15 seconds, with one vertical marker
 * per reported stomp. Peaks retain impacts that can fall between the firmware's
 * slower debug updates. Draw only actual reports; an empty history stays empty.
 */
import { MOTION_HISTORY_MS, type MotionHistoryPoint } from "../../core/motionHistory";

const WIDTH = 320;
const HEIGHT = 80;
const PAD = 6;

export function StompHistory({ samples, live = true }: { samples: readonly MotionHistoryPoint[]; live?: boolean }) {
  const last = samples.at(-1);
  const end = last?.time ?? 0;
  const readings = samples.filter((point) => Number.isFinite(point.peak) && point.time >= end - MOTION_HISTORY_MS);
  const ceiling = Math.ceil(Math.max(20, ...readings.map((point) => point.peak)) / 10) * 10;
  const x = (time: number) => PAD + ((time - (end - MOTION_HISTORY_MS)) / MOTION_HISTORY_MS) * (WIDTH - PAD * 2);
  const y = (value: number) => HEIGHT - PAD - Math.min(1, Math.max(0, value / ceiling)) * (HEIGHT - PAD * 2);
  const points = readings.map((point) => `${x(point.time).toFixed(1)},${y(point.peak).toFixed(1)}`).join(" ");
  const stomps = readings.filter((point) => point.stomp);

  return (
    <div className="signal-history">
      <svg className="history-plot" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={live && last ? `Peak acceleration over 15 seconds, ${stomps.length} reported stomps` : "Waiting for motion readings"}>
        <line className="waveform-axis" x1={PAD} x2={WIDTH - PAD} y1={y(9.81)} y2={y(9.81)} />
        {stomps.map((point, index) => <line key={`${point.time}-${index}`} className="stomp-marker" x1={x(point.time)} x2={x(point.time)} y1={PAD} y2={HEIGHT - PAD} />)}
        {readings.length > 1 && <polyline className="waveform-line" points={points} />}
        {last && <circle cx={x(last.time)} cy={y(last.peak)} r="2" fill="var(--ember)" />}
        <text className="history-scale" x={WIDTH - PAD} y="12" textAnchor="end">{ceiling}</text>
        <text className="history-scale" x={WIDTH - PAD} y={HEIGHT - PAD} textAnchor="end">0</text>
      </svg>
      <div className="waveform-readouts">
        <span>{live && last ? `${last.peak.toFixed(1)} m/s² peak` : "Waiting for motion"}</span>
        <span><i className="stomp-key" aria-hidden="true" /> Stomp · 15s</span>
      </div>
    </div>
  );
}
