/**
 * Finding boots and labeling them Left and Right. It's the first screen on a new phone.
 *
 * The iPhone scans and lists boots as they appear. Chrome only offers its own picker, so
 * there this shows an Add button instead, and each pick joins the same list. A boot with
 * a connection stops advertising, so boots you've already labeled are listed from the
 * store rather than the scan.
 */

import { useEffect, useState } from "react";
import { SIDE_NAMES, type BootsStore, type Side } from "../core/boots";
import type { FoundBoot } from "../transport/transport";

const signalWord = (rssi?: number) => {
  if (rssi === undefined) return "";
  if (rssi > -60) return "Strong signal";
  if (rssi > -75) return "Medium signal";
  return "Weak signal";
};

export function FindBoots({ store, onDone }: { store: BootsStore; onDone: () => void }) {
  const [found, setFound] = useState<FoundBoot[]>([]);
  const [noPick, setNoPick] = useState(false);
  const { finding } = store.transport;

  const addFound = (boot: FoundBoot) => {
    setFound((current) =>
      current.some((candidate) => candidate.deviceId === boot.deviceId)
        ? current.map((candidate) => (candidate.deviceId === boot.deviceId ? boot : candidate))
        : [...current, boot],
    );
  };

  useEffect(() => {
    if (finding !== "scan") return;
    void store.transport.startScan(addFound);
    return () => void store.transport.stopScan();
  }, [store, finding]);

  const pick = async () => {
    const boot = await store.transport.pick();
    setNoPick(boot === null);
    if (boot) addFound(boot);
  };

  // Labeled boots first, then anything the scan found that isn't labeled yet.
  const labeled: FoundBoot[] = store.sides().map((side) => {
    return { deviceId: store.known(side)!.deviceId, name: store.bootName(side) };
  });
  const rows = [...labeled, ...found.filter((boot) => !labeled.some((known) => known.deviceId === boot.deviceId))];

  return (
    <>
      <header className="topbar">
        <h1 className="screen-title">Find your boots</h1>
        {finding === "scan" && <span className="scanning">Scanning</span>}
      </header>

      <main className="scroll">
        {rows.map((boot) => (
          <BootRow key={boot.deviceId} store={store} boot={boot} />
        ))}

        {rows.length === 0 && finding === "scan" && (
          <p className="empty">Looking for boots. Make sure they're powered on and nearby.</p>
        )}

        {finding === "picker" && (
          <button type="button" className="button button-wide" onClick={() => void pick()}>
            Add a boot
          </button>
        )}
        {noPick && <p className="empty">No boot picked. Tap Add a boot to try again.</p>}

        <section className="help">
          <h2>Don't see a boot?</h2>
          <p>Each boot takes one connection at a time. If another device has it, it won't show up here.</p>
        </section>
      </main>

      <footer className="dock">
        <button type="button" className="button button-primary button-wide" disabled={store.sides().length === 0} onClick={onDone}>
          Done
        </button>
      </footer>
    </>
  );
}

function BootRow({ store, boot }: { store: BootsStore; boot: FoundBoot }) {
  const [blinking, setBlinking] = useState(false);
  const currentSide = store.sides().find((side) => store.known(side)?.deviceId === boot.deviceId);
  const online = currentSide && store.client(currentSide)?.getState().link === "online";

  const label = (side: Side) => (
    <button
      type="button"
      className={`button${currentSide === side ? " button-on" : ""}`}
      aria-pressed={currentSide === side}
      onClick={() => store.assign(boot, side)}
    >
      {SIDE_NAMES[side]}
    </button>
  );

  return (
    <article className="boot-card">
      <div className="boot-head">
        <span className="card-name">{boot.name}</span>
        <span className="card-hint">{currentSide ? (online ? "Connected" : "Reconnecting") : signalWord(boot.rssi)}</span>
      </div>
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={blinking}
          onClick={() => {
            setBlinking(true);
            void store.blinkFound(boot).finally(() => setBlinking(false));
          }}
        >
          {blinking ? "Blinking" : "Blink"}
        </button>
        {label("left")}
        {label("right")}
      </div>
    </article>
  );
}
