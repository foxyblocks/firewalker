// Per-boot microphone controls in Send to boot. These change the captured audio
// input for every recipe on that boot. The slider keeps its draft locally while
// dragging and sends once at the end, so USB/BLE stays available for replies.
import { useEffect, useState } from "react";

import { useBoots } from "./App";
import type { ConnectedBoot } from "../boot/connections";

export function BootAudioControls({ boot }: { boot: ConnectedBoot }) {
  const boots = useBoots();
  const [sensitivity, setSensitivity] = useState(boot.audio?.sensitivity ?? 65);
  useEffect(() => setSensitivity(boot.audio?.sensitivity ?? 65), [boot.audio?.sensitivity]);
  if (!boot.audio) return null;
  const disabled = boot.sending || !boot.audio.ready;
  const commit = () => {
    if (!disabled && sensitivity !== boot.audio?.sensitivity) void boots.configureAudio(boot.deviceId, sensitivity);
  };

  return (
    <div
      className="boot-audio"
      onKeyDown={(event) => {
        if (event.code === "Space") event.stopPropagation();
      }}
    >
      <div className="field-head">
        <strong>Microphone</strong>
        <button
          type="button"
          className="button small"
          disabled={disabled}
          onClick={() => void boots.configureAudio(boot.deviceId)}
        >
          Calibrate quiet
        </button>
      </div>
      <label className="field">
        <span className="field-head">
          <span>Sensitivity</span>
          <span className="readout">{sensitivity}%</span>
        </span>
        <input
          type="range"
          aria-label={`Audio sensitivity for ${boot.name}`}
          min={0}
          max={100}
          step={1}
          value={sensitivity}
          disabled={disabled}
          onChange={(event) => setSensitivity(Number(event.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </label>
      <p className="quiet small">
        {boot.audio.ready
          ? "Pause music before calibrating quiet. Higher sensitivity grows the bar with quieter sound. Applies to every audio pattern on this boot."
          : "Microphone capture is unavailable. Reconnect after checking the boot."}
      </p>
    </div>
  );
}
