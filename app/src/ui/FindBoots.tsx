/**
 * Finding boots and labeling them Left and Right. It's the first screen on a new phone.
 *
 * The iPhone scans and lists boots as they appear. A browser only offers its own picker, so
 * there this shows an Add button instead, and each pick joins the same list. A desktop browser
 * can reach a boot over Bluetooth or USB, so it gets a button for each. A boot with a
 * connection stops advertising, so boots you've already labeled are listed from the store
 * rather than the scan.
 *
 * The same boot can be listed twice with the same name, once per way of reaching it, so a row
 * says when it's the USB one. Labeling that row moves the boot to USB (`BootsStore.assign`).
 *
 * Calibrate sits under the labeled boots. It opens the Calibrate sheet for the boots chosen on
 * the Remote screen's tabs, as Both, Left, or Right, and its hint says which still need a
 * neutral pose.
 */

import { useEffect, useState } from "react";
import { SIDE_NAMES, type BootsStore, type RemoteView, type Side } from "../core/boots";
import { isUsbBoot, type FoundBoot, type PickMethod } from "../transport/transport";
import { joinNames } from "./parts";

const PICK_LABELS: Record<PickMethod | "only", string> = {
  only: "Add a boot",
  bluetooth: "Add over Bluetooth",
  usb: "Add over USB",
};

const NO_USB_PICK =
  "No boot picked. If no list of boots appeared, this browser can't show the USB picker, so open this page in Chrome or Arc.";

const signalWord = (rssi?: number) => {
  if (rssi === undefined) return "";
  if (rssi > -60) return "Strong signal";
  if (rssi > -75) return "Medium signal";
  return "Weak signal";
};

export function FindBoots({
  store,
  onDone,
  onCalibrate,
}: {
  store: BootsStore;
  onDone: () => void;
  onCalibrate: () => void;
}) {
  const [found, setFound] = useState<FoundBoot[]>([]);
  const [picking, setPicking] = useState(false);
  const [pickProblem, setPickProblem] = useState<string | null>(null);
  const { finding, pickers } = store.transport;
  const offersUsb = pickers.includes("usb");

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

  const pick = async (method: PickMethod) => {
    setPicking(true);
    setPickProblem(null);
    try {
      const boot = await store.transport.pick(method);
      if (boot) addFound(boot);
      // A browser with no USB picker, such as an embedded one, reports the same thing as
      // someone cancelling, so this can't tell them apart and covers both.
      else setPickProblem(method === "usb" ? NO_USB_PICK : "No boot picked. Tap Add to try again.");
    } catch (error) {
      setPickProblem(error instanceof Error ? error.message : "Couldn't reach that boot.");
    } finally {
      setPicking(false);
    }
  };

  // Labeled boots first, then anything the scan found that isn't labeled yet.
  const labeled: FoundBoot[] = store.sides().map((side) => {
    return { deviceId: store.known(side)!.deviceId, name: store.bootName(side) };
  });
  const rows = [...labeled, ...found.filter((boot) => !labeled.some((known) => known.deviceId === boot.deviceId))];
  const view = store.view();
  const names = (sides: Side[]) => joinNames(sides.map((side) => store.displayName(side)));

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

        {labeled.length > 0 && (
          <button
            type="button"
            className="dock-card dock-button calibrate-card"
            disabled={!view.controllable}
            onClick={onCalibrate}
          >
            <span className="card-name">Calibrate</span>
            <CalibrateHint view={view} names={names} />
          </button>
        )}

        {rows.length === 0 && finding === "scan" && (
          <p className="empty">Looking for boots. Make sure they're powered on and nearby.</p>
        )}

        {finding === "picker" &&
          pickers.map((method) => (
            <button key={method} type="button" className="button button-wide" disabled={picking} onClick={() => void pick(method)}>
              {PICK_LABELS[pickers.length > 1 ? method : "only"]}
            </button>
          ))}
        {pickProblem && (
          <p className="empty" role="status">
            {pickProblem}
          </p>
        )}

        <section className="help">
          <h2>Don't see a boot?</h2>
          <p>Each boot takes one connection at a time. If another device has it, it won't show up here.</p>
          {offersUsb && (
            <p>
              For USB, plug the boot into this computer. Only one program can use its port, so close ./cli and pio device monitor
              first.
            </p>
          )}
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

function CalibrateHint({ view, names }: { view: RemoteView; names: (sides: Side[]) => string }) {
  if (view.uncalibrated.length === 0) return <span className="card-hint">Neutral set</span>;
  return (
    <span className="card-hint">
      <span className="dot dot-wait" aria-hidden="true" />
      {names(view.uncalibrated)} not set
    </span>
  );
}

function BootRow({ store, boot }: { store: BootsStore; boot: FoundBoot }) {
  const [blinking, setBlinking] = useState(false);
  const currentSide = store.sides().find((side) => store.known(side)?.deviceId === boot.deviceId);
  const online = currentSide && store.client(currentSide)?.getState().link === "online";
  const usb = isUsbBoot(boot.deviceId);
  const linkWord = online ? "Connected" : "Reconnecting";
  const hint = currentSide ? `${linkWord}${usb ? " over USB" : ""}` : usb ? "On USB" : signalWord(boot.rssi);

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
        <span className="card-hint">{hint}</span>
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
