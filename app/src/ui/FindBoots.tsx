/**
 * The Boots tab lists saved and explicitly selected boots. Add opens a connection
 * sheet; it starts scanning or opens the system picker only after a method is chosen.
 * Each row opens one physical boot's detail screen. App owns the found list so returning
 * from a detail screen keeps the boot that was just selected. Main navigation replaces
 * the old Done action.
 */

import { useState } from "react";
import { SIDE_NAMES, type BootsStore } from "../core/boots";
import { isUsbBoot, type FoundBoot } from "../transport/transport";
import { calibrationNeed, sideOf } from "./bootFacts";
import { LinkDot, linkWords } from "./parts";
import { AddBootSheet } from "./AddBootSheet";
import { Button } from "./components/Button";
import { Icon } from "./components/Icon";

const signalWord = (rssi?: number) => {
  if (rssi === undefined) return "";
  if (rssi > -60) return "Strong signal";
  if (rssi > -75) return "Medium signal";
  return "Weak signal";
};

/** Adds a found boot to a list, or refreshes its entry, such as its signal. */
export function withFound(current: FoundBoot[], boot: FoundBoot): FoundBoot[] {
  return current.some((candidate) => candidate.deviceId === boot.deviceId)
    ? current.map((candidate) => (candidate.deviceId === boot.deviceId ? boot : candidate))
    : [...current, boot];
}

export function FindBoots({
  store,
  found,
  onFound,
  onOpen,
}: {
  store: BootsStore;
  found: FoundBoot[];
  onFound: (boot: FoundBoot) => void;
  onOpen: (boot: FoundBoot) => void;
}) {
  const [adding, setAdding] = useState(false);
  const offersUsb = store.transport.pickers.includes("usb");

  // Labeled boots first, then anything the scan found that isn't labeled yet.
  const labeled: FoundBoot[] = store.sides().map((side) => {
    return { deviceId: store.known(side)!.deviceId, name: store.bootName(side) };
  });
  const rows = [...labeled, ...found.filter((boot) => !labeled.some((known) => known.deviceId === boot.deviceId))];

  return (
    <>
      <header className="topbar boots-heading">
        <h2 className="screen-title">Boots</h2>
        <Button variant="primary" className="button-compact add-boot" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} /> Add
        </Button>
      </header>

      <main className="scroll">
        {rows.map((boot) => (
          <BootRow key={boot.deviceId} store={store} boot={boot} onOpen={() => onOpen(boot)} />
        ))}

        {rows.length === 0 && <p className="empty">Add a boot to connect it and set it up.</p>}

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

      {adding && (
        <AddBootSheet
          transport={store.transport}
          onClose={() => setAdding(false)}
          onChoose={(boot) => {
            onFound(boot);
            setAdding(false);
            onOpen(boot);
          }}
        />
      )}
    </>
  );
}

function BootRow({ store, boot, onOpen }: { store: BootsStore; boot: FoundBoot; onOpen: () => void }) {
  const side = sideOf(store, boot.deviceId);
  const state = side ? store.client(side)?.getState() : undefined;
  const online = state?.link === "online";
  const usb = isUsbBoot(boot.deviceId);
  const linkWord = linkWords(state?.link);
  const hint = side ? `${linkWord}${usb && online ? " over USB" : ""}` : usb ? "On USB" : signalWord(boot.rssi);
  const need = calibrationNeed(state);

  return (
    <button type="button" className="boot-card boot-row" onClick={onOpen}>
      <span className="boot-row-main">
        <span className="boot-row-title">
          <span className="card-name">{side ? store.displayName(side) : boot.name}</span>
          {/* A boot named after its side needs no tag saying so again. */}
          {!side ? (
            <span className="side-tag side-tag-none">Not labeled</span>
          ) : store.displayName(side) !== SIDE_NAMES[side] ? (
            <span className="side-tag">{SIDE_NAMES[side]}</span>
          ) : null}
        </span>
        <span className="card-hint">
          {side && <LinkDot link={state?.link} />}
          {side ? `${store.bootName(side)} · ${hint}` : hint}
        </span>
        {need && (
          <span className="card-hint tone-warn">
            <span className="dot dot-wait" aria-hidden="true" />
            {need}
          </span>
        )}
      </span>
      <span className="boot-row-go" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
