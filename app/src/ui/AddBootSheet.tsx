/**
 * Choose a connection before opening the system picker or starting an iPhone scan.
 * Only a selected boot reaches FindBoots/App; canceling leaves the saved boots alone.
 * The active flag also ignores a late picker result after the sheet was closed.
 */
import { useEffect, useRef, useState } from "react";
import type { FoundBoot, PickMethod, Transport } from "../transport/transport";
import { Button } from "./components/Button";
import { Icon } from "./components/Icon";
import { Notice } from "./components/Notice";
import { Sheet } from "./components/Sheet";

export function AddBootSheet({ transport, onChoose, onClose }: {
  transport: Transport;
  onChoose: (boot: FoundBoot) => void;
  onClose: () => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<FoundBoot[]>([]);
  const [picking, setPicking] = useState<PickMethod>();
  const [problem, setProblem] = useState<string>();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    if (!scanning) return;
    let listening = true;
    void transport.startScan((boot) => {
      if (!listening) return;
      setFound((current) => current.some((entry) => entry.deviceId === boot.deviceId)
        ? current.map((entry) => entry.deviceId === boot.deviceId ? boot : entry) : [...current, boot]);
    }).catch((error: unknown) => {
      if (listening) setProblem(error instanceof Error ? error.message : "Couldn't scan for boots.");
    });
    return () => {
      listening = false;
      void transport.stopScan().catch(() => undefined);
    };
  }, [scanning, transport]);

  const choose = async (method: PickMethod) => {
    setProblem(undefined);
    if (method === "bluetooth" && transport.finding === "scan") {
      setFound([]);
      setScanning(true);
      return;
    }
    setPicking(method);
    try {
      // Invoke the system picker directly from the tap, while browser activation
      // is still available. No connection or pairing is saved until a boot is chosen.
      const boot = await transport.pick(method);
      if (!active.current) return;
      if (boot) onChoose(boot);
    } catch (error) {
      if (active.current) setProblem(error instanceof Error ? error.message : "Couldn't reach that boot.");
    } finally {
      if (active.current) setPicking(undefined);
    }
  };

  return (
    <Sheet title={scanning ? "Nearby boots" : "Add a boot"} onClose={onClose} closeLabel="Cancel">
      <div className="stack">
        {scanning ? (
          <>
            <p className="help-text" role="status">Choose a boot over Bluetooth. Keep it powered on and nearby.</p>
            {found.map((boot) => (
              <Button key={boot.deviceId} wide onClick={() => onChoose(boot)}>{boot.name}</Button>
            ))}
            {found.length === 0 && <p className="help-text">Looking for boots…</p>}
            <button type="button" className="link" onClick={() => setScanning(false)}>‹ Connection options</button>
          </>
        ) : (
          <>
            <p className="help-text">How would you like to connect?</p>
            {(["usb", "bluetooth"] as const).map((method) => {
              const supported = transport.pickers.includes(method) || (method === "bluetooth" && transport.finding === "scan");
              return (
                <button key={method} type="button" className="connection-option" disabled={!supported || picking !== undefined} onClick={() => void choose(method)}>
                  <Icon name={method} size={24} />
                  <span>
                    <span className="card-name">{method === "usb" ? "USB" : "Bluetooth"}</span>
                    <span className="card-hint">{picking === method ? "Choose a boot in the picker…" : !supported ? "Not available on this device" : method === "usb" ? "Connect with a USB cable" : "Connect wirelessly"}</span>
                  </span>
                </button>
              );
            })}
          </>
        )}
        {problem && <Notice tone="bad">{problem}</Notice>}
      </div>
    </Sheet>
  );
}
