/**
 * The home screen: choose Both, Left, or Right, then control them. Patterns take the
 * middle of the screen and scroll, while a bar pinned at the bottom holds Audio, Brightness,
 * and the Lights switch side by side. So however many patterns a boot has, your thumb always
 * knows where those are. Audio and Brightness each open a drawer that slides up over the
 * patterns. A second tap on the same section, a tap on the dimmed patterns, or Escape closes
 * it. All the numbers come from `store.view()`, which shows what the boots reported, plus any
 * tap still on its way.
 *
 * There's no brightness cap switch. The store keeps every boot's soft cap off, so the slider
 * runs to the boot's full range, and the levels past the cap sit inside a yellow outline whose
 * warning sign explains them on a tap. The bar's brightness reading turns yellow past it too,
 * so the warning shows with the drawer closed. Audio tuning is per boot (AudioSetup.tsx).
 * Each boot's calibration, status, and debug output live on its own screen under the app's
 * Boots tab. The app frame owns main navigation.
 */

import { useEffect, useState } from "react";
import { SIDE_NAMES, type BootsStore, type PatternTile, type RemoteView, type Side, type Target } from "../core/boots";
import { patternDisplay } from "../core/patternNames";
import { AudioControls, audioSummary } from "./AudioSetup";
import { ChevronIcon } from "./components/Button";
import { Icon, type IconName } from "./components/Icon";
import { Segmented } from "./components/Segmented";
import { joinNames, LinkDot, PixelSlider, SideBadge, WarningIcon, type SliderWarning } from "./parts";

const CAP_MESSAGE = "Past this line, full white can draw more than USB gives, about 1 A.";
/** How long the drawer takes to slide away, matching `drawer-out` in styles.css. */
const DRAWER_CLOSE_MS = 160;

type Drawer = "audio" | "brightness";

export function Remote({ store, onBoots }: { store: BootsStore; onBoots: () => void }) {
  const view = store.view();
  const names = (sides: Side[]) => joinNames(sides.map((side) => store.displayName(side)));

  return (
    <>
      <TargetTabs store={store} onBoots={onBoots} />

      <main className="scroll">
        <Banners view={view} names={names} onRestoreAccess={() => void store.restoreAccess()} />
        <div className="section-head">
          <span className="section-label">Pattern</span>
          <SaveLine view={view} names={names} />
        </div>
        <div className="tiles">
          {view.tiles.map((tile) => (
            <Tile
              key={tile.id}
              tile={tile}
              names={names}
              disabled={!view.controllable}
              onSelect={() => store.selectPattern(tile.id)}
            />
          ))}
        </div>
      </main>

      <Dock store={store} view={view} names={names} />
    </>
  );
}

/**
 * The bottom bar and its drawer. The drawer stays mounted for its slide-away, then unmounts,
 * so the audio blocks stop watching their boots once it's gone.
 */
function Dock({ store, view, names }: { store: BootsStore; view: RemoteView; names: (sides: Side[]) => string }) {
  const [open, setOpen] = useState<Drawer>();
  const [shown, setShown] = useState<Drawer>();
  const drawer = open ?? shown;
  const leaving = open === undefined && shown !== undefined;

  useEffect(() => {
    if (open !== undefined) {
      setShown(open);
      return;
    }
    const timer = setTimeout(() => setShown(undefined), DRAWER_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (open === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(undefined);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = (next: Drawer) => setOpen((current) => (current === next ? undefined : next));
  const percent = view.maxBrightness > 0 ? Math.round((view.brightness / view.maxBrightness) * 100) : 0;
  const cap = view.capBrightness;
  const capWarning: SliderWarning | undefined =
    cap !== undefined && view.maxBrightness > cap
      ? { above: cap, label: "About the brightness cap", message: CAP_MESSAGE }
      : undefined;
  const overCap = view.controllable && capWarning !== undefined && view.brightness > capWarning.above;

  return (
    <footer className={`dock${drawer ? " dock-open" : ""}`}>
      {drawer && (
        <>
          <div className={`drawer-scrim${leaving ? " drawer-leaving" : ""}`} aria-hidden="true" onClick={() => setOpen(undefined)} />
          <div className="drawer-clip">
            <section
              id="remote-drawer"
              className={`drawer${leaving ? " drawer-leaving" : ""}`}
              aria-label={drawer === "audio" ? "Audio" : "Brightness"}
            >
              <header className="drawer-head">
                <span className="section-label">{drawer === "audio" ? "Audio" : "Brightness"}</span>
                <span className="drawer-head-end">
                  {drawer === "brightness" && (
                    <span className={`readout${overCap ? " readout-warn" : ""}`}>{view.controllable ? `${percent}%` : "--"}</span>
                  )}
                  <button type="button" className="drawer-close" aria-label="Close" onClick={() => setOpen(undefined)}>
                    <ChevronIcon />
                  </button>
                </span>
              </header>
              {drawer === "audio" ? (
                <AudioControls store={store} />
              ) : (
                <div className="brightness-drawer">
                  <PixelSlider
                    label="Brightness"
                    value={view.brightness}
                    min={1}
                    max={view.maxBrightness}
                    disabled={!view.controllable}
                    onStart={() => store.setDragging(true)}
                    onChange={(level) => store.setBrightness(level)}
                    onEnd={() => store.setDragging(false)}
                    warning={capWarning}
                  />
                  {view.chosen.length > 1 && <span className="help-text help-small">Sets {names(view.chosen)} together.</span>}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      <div className="control-bar">
        <BarButton
          icon="mic"
          label="Audio"
          value={audioSummary(store)}
          open={drawer === "audio" && !leaving}
          onClick={() => toggle("audio")}
        />
        <BarButton
          icon="sun"
          label="Brightness"
          value={view.controllable ? `${percent}%` : "--"}
          warn={overCap}
          open={drawer === "brightness" && !leaving}
          onClick={() => toggle("brightness")}
        />
        <button
          type="button"
          role="switch"
          aria-checked={view.on}
          aria-label="Lights"
          className={`bar-cell bar-power${view.on && view.controllable ? " bar-power-on" : ""}`}
          disabled={!view.controllable}
          onClick={() => store.setPower(!view.on)}
        >
          <span className="bar-label">
            <Icon name="power" size={14} />
            Lights
          </span>
          <span className="bar-power-row">
            <span className="bar-value">{view.controllable ? (view.on ? "On" : "Off") : "--"}</span>
            <span className={`toggle toggle-small${view.on ? " toggle-on" : ""}`} aria-hidden="true">
              <span className="toggle-knob" />
            </span>
          </span>
        </button>
      </div>
    </footer>
  );
}

/** One of the bar's drawer sections: a label, its current reading, and which way it slides. */
function BarButton({
  icon,
  label,
  value,
  warn,
  open,
  onClick,
}: {
  icon: IconName;
  label: string;
  value: string;
  warn?: boolean;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`bar-cell${open ? " bar-cell-on" : ""}`}
      aria-expanded={open}
      aria-controls={open ? "remote-drawer" : undefined}
      onClick={onClick}
    >
      <span className="bar-label">
        <Icon name={icon} size={14} />
        {label}
        <ChevronIcon open={!open} />
      </span>
      <span className={`bar-value readout${warn ? " readout-warn" : ""}`}>
        {value}
        {warn && <WarningIcon />}
      </span>
    </button>
  );
}

function TargetTabs({ store, onBoots }: { store: BootsStore; onBoots: () => void }) {
  const known = store.sides();
  const select = (target: Target) => {
    if (target !== "both" && !known.includes(target)) onBoots();
    else store.setTarget(target);
  };
  const sideOption = (side: Side) => {
    const link = store.client(side)?.getState().link;
    return {
      value: side,
      label: store.known(side) ? store.displayName(side) : SIDE_NAMES[side],
      lead: <LinkDot link={link} />,
      dimmed: Boolean(store.known(side) && link !== "online"),
    };
  };

  return (
    <div className="tabs-bar">
      <Segmented<Target>
        label="What a tap controls"
        size="large"
        value={store.target}
        onChange={select}
        options={[{ value: "both", label: "Both", disabled: known.length < 2 }, sideOption("left"), sideOption("right")]}
      />
    </div>
  );
}

/** One pattern. Its strip previews the pattern, and the badges show which boots run it. */
function Tile({
  tile,
  names,
  disabled,
  onSelect,
}: {
  tile: PatternTile;
  names: (sides: Side[]) => string;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { name, description } = patternDisplay(tile.id);
  const running = tile.runningOn.length > 0;
  const hint = tile.missingOn.length > 0 ? `${names(tile.missingOn)} needs update` : description;
  const previewClass = ["rainbow-pool", "flow"].includes(tile.id)
    ? "preview-flow"
    : ["fire-stomp", "fire-trail"].includes(tile.id) ? "preview-fire" : "preview-other";

  return (
    <button type="button" className={`tile${running ? " tile-on" : ""}`} aria-pressed={running} disabled={disabled} onClick={onSelect}>
      <span className="tile-head">
        <span className="tile-name">{name}</span>
        <span className="tile-badges">
          {tile.runningOn.map((side) => (
            <SideBadge key={side} side={side} />
          ))}
        </span>
      </span>
      {hint && <span className={`tile-hint${tile.missingOn.length > 0 ? " tile-hint-warn" : ""}`}>{hint}</span>}
      <span className={`tile-preview ${previewClass}`} aria-hidden="true" />
    </button>
  );
}

function SaveLine({ view, names }: { view: RemoteView; names: (sides: Side[]) => string }) {
  if (!view.controllable) return null;
  if (view.saveFailed.length > 0) return <span className="save-line save-failed">Not saved</span>;
  return (
    <span className="save-line">
      <span className={`dot ${view.saving ? "dot-wait" : "dot-good"}`} aria-hidden="true" />
      {view.saving ? "Saving" : `Saved on ${names(view.chosen.filter((side) => !view.offline.includes(side)))}`}
    </span>
  );
}

function Banners({
  view,
  names,
  onRestoreAccess,
}: {
  view: RemoteView;
  names: (sides: Side[]) => string;
  onRestoreAccess: () => void;
}) {
  const banners: { tone: "bad" | "warn"; text: string }[] = [];
  if (view.outdated.length > 0) {
    banners.push({ tone: "bad", text: `${names(view.outdated)}: update this boot's firmware to use it with this app.` });
  }
  if (view.saveFailed.length > 0) {
    banners.push({ tone: "bad", text: `Not saved on ${names(view.saveFailed)}. This won't survive a power cycle.` });
  }
  if (view.sensorMissing.length > 0) {
    banners.push({
      tone: "bad",
      text: `${names(view.sensorMissing)}: motion sensor unavailable. Power and brightness still work.`,
    });
  }
  if (view.offline.length > 0) {
    const others = view.controllable ? " Controls apply to the other boot for now." : "";
    banners.push({ tone: "warn", text: `Reconnecting to ${names(view.offline)}.${others}` });
  }
  if (view.noAnswer.length > 0) {
    banners.push({ tone: "warn", text: `${names(view.noAnswer)} didn't answer. Showing its last reported settings.` });
  }
  if (view.needsUpdate) {
    const { name } = patternDisplay(view.needsUpdate.pattern);
    banners.push({ tone: "warn", text: `${names(view.needsUpdate.sides)} needs a firmware update for ${name}.` });
  }
  if (banners.length === 0 && view.accessLost.length === 0) return null;
  return (
    <div className="banners">
      {view.accessLost.length > 0 && (
        <div className="banner banner-warn banner-action" role="status">
          <span>This browser can't reach {names(view.accessLost)} since the page reloaded. Pick each boot once to get it back.</span>
          <button type="button" className="button" onClick={onRestoreAccess}>
            Reconnect
          </button>
        </div>
      )}
      {banners.map((banner) => (
        <p key={banner.text} className={`banner banner-${banner.tone}`} role="status">
          {banner.text}
        </p>
      ))}
    </div>
  );
}
