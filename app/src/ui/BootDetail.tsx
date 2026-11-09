/**
 * One physical boot, opened from the Boots list. It's chosen by device id rather than side,
 * and its side is looked up again on every render, so labeling it Left or Right, or swapping
 * it with the other boot, keeps this screen on the same boot in your hand.
 *
 * The header identifies the device, shows its connection, and offers Blink. Configuration
 * starts with Side, followed by pose/strip sheets and Forget. Rename lives beside Blink.
 * Side must be chosen before configuring the boot or viewing Diagnostics.
 * Everything here talks to this one boot only; nothing reads the Remote screen's Both, Left,
 * or Right choice.
 *
 * A boot that isn't labeled yet has no connection, since a boot takes one at a time. It can
 * still blink, through a short-lived connection, and choosing its side connects to it. Until
 * then, calibration and diagnostics say what to do first.
 *
 * While a pose countdown, capture, or clear runs, the back link, the side choice, the tabs,
 * and Forget all hold still, so the result can't land on a screen you've left.
 */

import { useEffect, useRef, useState } from "react";
import { SIDE_NAMES, type BootsStore, type Side } from "../core/boots";
import { PROTOCOL_VERSION } from "../core/protocol";
import { isUsbBoot, type FoundBoot } from "../transport/transport";
import { calibrationNeed, sideOf } from "./bootFacts";
import { Button } from "./components/Button";
import { Notice } from "./components/Notice";
import { Segmented } from "./components/Segmented";
import { TextField } from "./components/TextField";
import { Sheet } from "./components/Sheet";
import { Diagnostics } from "./Diagnostics";
import { LinkDot, linkWords } from "./parts";
import { PoseCalibration } from "./PoseCalibration";
import { StripSetup } from "./StripSetup";

// Long enough to see a labeled boot's blink through, matching an unlabeled boot's hold.
const BLINK_HOLD_MS = 2500;

type Section = "configuration" | "diagnostics";
type CalibrationSheet = "poses" | "strip";

export type BootSection = Section;

export function BootDetail({
  store,
  boot,
  onBack,
  initialSection = "configuration",
  onBusy,
}: {
  store: BootsStore;
  boot: FoundBoot;
  onBack: () => void;
  initialSection?: Section;
  onBusy?: (busy: boolean) => void;
}) {
  const side = sideOf(store, boot.deviceId);
  const client = side ? store.client(side) : undefined;
  const state = client?.getState();
  const [section, setSection] = useState<Section>(initialSection);
  const [poseBusy, setPoseBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const selectedSection = side ? section : "configuration";
  const locked = poseBusy || Boolean(state?.capture || state?.clearingCalibration);
  const bootName = side ? store.bootName(side) : boot.name;
  const title = side ? store.displayName(side) : bootName;
  // The persistent main tabs must respect the same capture lock as this screen.
  useEffect(() => {
    onBusy?.(locked);
    return () => onBusy?.(false);
  }, [locked, onBusy]);

  return (
    <>
      <div className="detail-back-row">
        <button type="button" className="link detail-back" disabled={locked} onClick={onBack}>‹ Boots</button>
      </div>
      <header className="detail-head">
        <h1 className="screen-title">{title}</h1>
        <div className="detail-actions">
          <Button className="button-compact detail-rename" disabled={locked || !side} onClick={() => setRenaming(true)}>Rename</Button>
          <BlinkButton store={store} boot={boot} side={side} disabled={locked} />
        </div>
        <span className="card-hint detail-meta">
          {side && <><LinkDot link={state?.link} /><span>{bootName}</span><span aria-hidden="true">·</span></>}
          <span>{side
            ? `${linkWords(state?.link)}${state?.link === "online" && isUsbBoot(boot.deviceId) ? " over USB" : ""}`
            : isUsbBoot(boot.deviceId) ? "On USB, not labeled" : "Not labeled"}</span>
        </span>
      </header>
      {renaming && side && <RenameSheet store={store} side={side} onClose={() => setRenaming(false)} />}

      <div className="tabs-bar">
        <Segmented<Section>
          label="Boot sections"
          appearance="joined"
          size="large"
          value={selectedSection}
          onChange={setSection}
          disabled={locked}
          idPrefix="boot-section"
          options={[
            { value: "configuration", label: "Configuration" },
            { value: "diagnostics", label: "Diagnostics", disabled: !side },
          ]}
        />
      </div>

      <main className="scroll" id={`boot-section-${selectedSection}`} role="tabpanel">
        {selectedSection === "configuration" ? (
          <Configuration store={store} boot={boot} side={side} locked={locked} onPoseBusy={setPoseBusy} onForgotten={onBack} />
        ) : client ? (
          <Diagnostics key={client.deviceId} client={client} name={store.displayName(side!)} />
        ) : (
          <Notice>Choose Left or Right under Configuration to connect to this boot. Then this shows what it reports.</Notice>
        )}
      </main>
    </>
  );
}

function Configuration({
  store,
  boot,
  side,
  locked,
  onPoseBusy,
  onForgotten,
}: {
  store: BootsStore;
  boot: FoundBoot;
  side: Side | undefined;
  locked: boolean;
  onPoseBusy: (busy: boolean) => void;
  onForgotten: () => void;
}) {
  return (
    <div className="stack stack-loose">
      <Identity store={store} boot={boot} side={side} locked={locked} />
      <Calibration store={store} side={side} locked={locked} onPoseBusy={onPoseBusy} />
      {side && <Forget store={store} side={side} disabled={locked} onForgotten={onForgotten} />}
    </div>
  );
}

/** Identify this physical boot without changing its side or configuration. */
function BlinkButton({ store, boot, side, disabled }: { store: BootsStore; boot: FoundBoot; side: Side | undefined; disabled: boolean }) {
  const [blinking, setBlinking] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const known = side ? store.known(side) : undefined;
  // The name this boot was saved under, so a relabel can't look like a different boot.
  const found: FoundBoot = { deviceId: boot.deviceId, name: known?.name ?? boot.name };
  const online = side ? store.client(side)?.getState().link === "online" : true;

  const blink = async () => {
    setBlinking(true);
    try {
      await store.blinkFound(found);
      if (side) await new Promise((resolve) => setTimeout(resolve, BLINK_HOLD_MS));
    } finally {
      if (mounted.current) setBlinking(false);
    }
  };

  return (
    <Button className="button-compact detail-blink" busy={blinking} disabled={disabled || !online} onClick={() => void blink()}>
      {blinking ? "Blinking" : "Blink"}
    </Button>
  );
}

/** Choosing a side opens a persistent connection and enables the rest of this screen. */
function Identity({ store, boot, side, locked }: { store: BootsStore; boot: FoundBoot; side: Side | undefined; locked: boolean }) {
  const known = side ? store.known(side) : undefined;
  const found: FoundBoot = { deviceId: boot.deviceId, name: known?.name ?? boot.name };
  return (
    <section className="panel side-card" aria-label="Side">
      <span className="field-label">Side</span>
      <Segmented<Side>
        label="Side"
        kind="choice"
        value={side}
        disabled={locked}
        onChange={(next) => { if (next !== side) store.assign(found, next); }}
        options={[{ value: "left", label: "Left" }, { value: "right", label: "Right" }]}
      />
      {!side && <p className="help-text help-small">Blink to identify this boot, then choose its side to enable configuration and diagnostics.</p>}
    </section>
  );
}

/** Launches sheets for this physical boot; neither control changes the current tab. */
function Calibration({ store, side, locked, onPoseBusy }: {
  store: BootsStore;
  side: Side | undefined;
  locked: boolean;
  onPoseBusy: (busy: boolean) => void;
}) {
  const client = side ? store.client(side) : undefined;
  const state = client?.getState();
  const status = state?.status;
  const [sheet, setSheet] = useState<CalibrationSheet>();
  const need = calibrationNeed(state);
  const name = side ? store.displayName(side) : "this boot";
  let unavailable;
  if (!client || !side) unavailable = "Choose Left or Right above first. That connects to this boot so you can configure it.";
  else if (!status) unavailable = `${linkWords(state?.link)} to ${name}. Waiting for its first report.`;
  else if ((status.proto ?? 0) < PROTOCOL_VERSION) unavailable = `Update ${name}'s firmware to calibrate it with this app.`;

  return (
    <section aria-label="Calibrate" className={!side ? "section-disabled" : undefined}>
      <div className="section-head">
        <span className="section-label">Calibrate</span>
        {need && <span className="card-hint tone-warn">{need}</span>}
      </div>
      <div className="setup-actions">
        <Button className="setup-action" disabled={locked || Boolean(unavailable)} onClick={() => setSheet("poses")}>
          <span>Poses</span><span className="card-hint">Neutral, heel &amp; toe</span>
        </Button>
        <Button className="setup-action" disabled={locked || Boolean(unavailable)} onClick={() => setSheet("strip")}>
          <span>Strip</span><span className="card-hint">LED count &amp; positions</span>
        </Button>
      </div>
      {unavailable && side && <Notice>{unavailable}</Notice>}
      {sheet && client && (
        <Sheet title={`${sheet === "poses" ? "Poses" : "Strip"} · ${name}`} closeDisabled={locked} onClose={() => setSheet(undefined)}>
          {sheet === "poses"
            ? <PoseCalibration key={client.deviceId} client={client} name={name} onBusy={onPoseBusy} />
            : <StripSetup key={client.deviceId} client={client} name={name} />}
        </Sheet>
      )}
    </section>
  );
}

/** Rename stays in the header; the sheet keeps editing separate from capture controls. */
function RenameSheet({ store, side, onClose }: { store: BootsStore; side: Side; onClose: () => void }) {
  const [draft, setDraft] = useState(store.known(side)?.nickname ?? "");
  return (
    <Sheet title="Rename boot" onClose={onClose} closeLabel="Cancel">
      <form className="rename" onSubmit={(event) => {
        event.preventDefault();
        store.rename(side, draft);
        onClose();
      }}>
        <TextField
          label="Boot name"
          value={draft}
          maxLength={12}
          autoFocus
          placeholder={SIDE_NAMES[side]}
          hint={`Up to 12 letters. Leave it blank to go back to ${SIDE_NAMES[side]}.`}
          onChange={setDraft}
        />
        <Button type="submit" variant="primary" wide>Save name</Button>
      </form>
    </Sheet>
  );
}

function Forget({ store, side, disabled, onForgotten }: { store: BootsStore; side: Side; disabled: boolean; onForgotten: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="danger-zone" aria-label="Forget this boot">
      <Button
        variant="danger"
        wide
        disabled={disabled}
        onBlur={() => setConfirming(false)}
        onClick={() => {
          if (!confirming) {
            setConfirming(true);
            return;
          }
          store.forget(side);
          onForgotten();
        }}
      >
        {confirming ? "Tap again to forget" : "Forget this boot"}
      </Button>
      <p className="help-text help-small">
        {confirming
          ? "This phone stops connecting to it. The boot keeps its settings and keeps running."
          : "Removes it from this phone. You can find it again from Boots."}
      </p>
    </section>
  );
}
