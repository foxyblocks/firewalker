// The simulator's audio input. Web Audio turns a browser-selected stream into a
// level and a short spectrum for AudioMonitor. The returned session owns the
// stream, including tracks that arrive after the monitor has already stopped.

export type AudioSource = "microphone" | "computer";

const BAND_EDGES_HZ = [45, 90, 180, 360, 720, 1440, 2880, 5760, 11520];
export const SILENCE = { level: 0, bands: BAND_EDGES_HZ.slice(1).map(() => 0) };

interface AudioCapture {
  ready: Promise<void>;
  read(): typeof SILENCE;
  stop(): void;
}

function normalizeDb(db: number, floor: number, ceiling: number): number {
  return Math.max(0, Math.min(1, (db - floor) / (ceiling - floor)));
}

/**
 * Start from a user gesture so the browser can open its share picker. Stop is
 * safe while the picker is open. onEnded handles sharing stopped by the browser.
 */
export function startAudioCapture(source: AudioSource, onEnded: () => void): AudioCapture {
  const devices = navigator.mediaDevices;
  if (!devices || typeof AudioContext === "undefined") {
    throw new Error("Audio capture needs localhost or an HTTPS page in a supported browser.");
  }
  if (source === "computer" && !devices.getDisplayMedia) {
    throw new Error("This browser can't share computer audio. Try desktop Chrome or Edge.");
  }

  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.65;

  // Keep the audio graph running without playing the captured signal back.
  const mute = context.createGain();
  mute.gain.value = 0;
  analyser.connect(mute).connect(context.destination);
  const waveform = new Float32Array(analyser.fftSize);
  const spectrum = new Float32Array(analyser.frequencyBinCount);
  const hzPerBin = context.sampleRate / analyser.fftSize;
  let stream: MediaStream | undefined;
  let stopped = false;

  function stop() {
    if (stopped) return;
    stopped = true;
    stream?.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => {});
  }

  async function connect() {
    try {
      // The browser's share API requires a video track even when we only need audio.
      // Keep the share open for its lifetime, and connect only its audio to Web Audio.
      const displayOptions: DisplayMediaStreamOptions & { systemAudio: "include" } = {
        video: true,
        audio: true,
        systemAudio: "include",
      };
      const request = source === "computer"
        ? devices.getDisplayMedia(displayOptions)
        : devices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });

      await Promise.all([
        request.then((shared) => {
          if (stopped) {
            shared.getTracks().forEach((track) => track.stop());
            return;
          }
          stream = shared;
          const [audio] = shared.getAudioTracks();
          if (!audio || audio.readyState === "ended") {
            throw new Error("No audio was shared. Choose a tab or screen and enable Share audio.");
          }
          for (const track of shared.getTracks()) {
            track.addEventListener("ended", onEnded, { once: true });
          }
          context.createMediaStreamSource(new MediaStream([audio])).connect(analyser);
        }),
        context.resume(),
      ]);
    } catch (error) {
      stop();
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        throw new Error(source === "microphone"
          ? "Microphone access was blocked. Allow it in your browser and try again."
          : "Sharing was canceled or blocked. Listen again to choose a source.");
      }
      throw error;
    }
  }

  function read() {
    analyser.getFloatTimeDomainData(waveform);
    analyser.getFloatFrequencyData(spectrum);
    let sumSquares = 0;
    for (const sample of waveform) sumSquares += sample * sample;

    // The percentage is a relative signal level, not the computer's volume setting.
    // A log scale makes quiet but usable inputs visible next to loud music.
    const level = normalizeDb(10 * Math.log10(sumSquares / waveform.length), -60, -12);
    const bands = BAND_EDGES_HZ.slice(1).map((edge, index) => {
      const start = Math.ceil(BAND_EDGES_HZ[index]! / hzPerBin);
      const end = Math.min(spectrum.length, Math.ceil(edge / hzPerBin));
      let peak = -Infinity;
      for (let bin = start; bin < end; bin++) peak = Math.max(peak, spectrum[bin]!);
      return normalizeDb(peak, -85, -24);
    });
    return { level, bands };
  }

  return { ready: connect(), read, stop };
}
