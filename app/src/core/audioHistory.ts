/**
 * Recent volume readings for one boot's Diagnostics view. BootClient appends each
 * validated audio report before React renders, so several reports arriving together
 * still appear in the graph. This stores the reported 0–1 volume, not the individual
 * microphone samples drawn by AudioWaveform. Receipt times match motion history.
 */
import type { AudioSignalReply } from "./protocol";

export const AUDIO_HISTORY_MS = 15_000;
const MAX_POINTS = 150;

export interface AudioHistoryPoint {
  time: number;
  level: number;
}

/** Keep a bounded rolling window; an unavailable microphone clears its previous signal. */
export function appendAudio(history: readonly AudioHistoryPoint[], audio: AudioSignalReply, time: number): readonly AudioHistoryPoint[] {
  if (!audio.ready) return [];
  const recent = history.filter((point) => point.time >= time - AUDIO_HISTORY_MS && point.time <= time);
  return [...recent.slice(-(MAX_POINTS - 1)), { time, level: audio.level }];
}
