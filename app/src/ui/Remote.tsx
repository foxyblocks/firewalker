/**
 * The home screen: choose Both, Left, or Right, then control them. Patterns take the
 * middle of the screen and scroll, while brightness, power, and Calibrate stay pinned in
 * a dock at the bottom. So however many patterns a boot has, your thumb always knows
 * where those are. All the numbers come from `store.view()`, which shows what the boots
 * reported, plus any tap still on its way.
 */

import { SIDE_NAMES, type BootsStore, type PatternTile, type RemoteView, type Side, type Target } from "../core/boots";
import { patternDisplay } from "../core/patternNames";
import { BrightnessStrip, joinNames, LinkDot, SideBadge, Toggle } from "./parts";

export function Remote({
  store,
  onStatus,
  onBoots,
  onCalibrate,
}: {
  store: BootsStore;
  onStatus: () => void;
  onBoots: () => void;
  onCalibrate: () => void;
}) {
  const view = store.view();
  const names = (sides: Side[]) => joinNames(sides.map((side) => store.displayName(side)));
  const percent = view.maxBrightness > 0 ? Math.round((view.brightness / view.maxBrightness) * 100) : 0;
  const canCalibrate = store.calibrationSides().length > 0;

  return (
    <>
      <header className="topbar">
        <h1 className="wordmark">Firewalker</h1>
        <nav className="topbar-links">
          <button type="button" className="link" onClick={onBoots}>
            Boots
          </button>
          <button type="button" className="link" onClick={onStatus}>
            Status
          </button>
        </nav>
      </header>

      <TargetTabs store={store} onBoots={onBoots} />

      <main className="scroll">
        <Banners view={view} names={names} />
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

      <footer className="dock">
        <div className="section-head">
          <span className="section-label">Brightness</span>
          <span className="readout">{view.controllable ? `${percent}%` : "--"}</span>
        </div>
        <BrightnessStrip
          value={view.brightness}
          max={view.maxBrightness}
          disabled={!view.controllable}
          onStart={() => store.setDragging(true)}
          onChange={(level) => store.setBrightness(level)}
          onEnd={() => store.setDragging(false)}
        />
        <div className="dock-row">
          <div className="dock-card">
            <span className="card-name">Lights {view.on ? "on" : "off"}</span>
            <Toggle
              on={view.on}
              label="Lights"
              disabled={!view.controllable}
              onChange={(on) => store.setPower(on)}
            />
          </div>
          <button type="button" className="dock-card dock-button" disabled={!canCalibrate} onClick={onCalibrate}>
            <span className="card-name">Calibrate</span>
            <CalibrateHint view={view} names={names} />
          </button>
        </div>
      </footer>
    </>
  );
}

function TargetTabs({ store, onBoots }: { store: BootsStore; onBoots: () => void }) {
  const known = store.sides();
  const select = (target: Target) => {
    if (target !== "both" && !known.includes(target)) onBoots();
    else store.setTarget(target);
  };
  const tab = (target: Side) => {
    const link = store.client(target)?.getState().link;
    const dimmed = store.known(target) && link !== "online";
    return (
      <button
        type="button"
        role="tab"
        aria-selected={store.target === target}
        className={`tab${store.target === target ? " tab-on" : ""}${dimmed ? " tab-offline" : ""}`}
        onClick={() => select(target)}
      >
        <LinkDot link={link} />
        <span className="tab-name">{store.known(target) ? store.displayName(target) : SIDE_NAMES[target]}</span>
      </button>
    );
  };

  return (
    <div className="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={store.target === "both"}
        className={`tab${store.target === "both" ? " tab-on" : ""}`}
        disabled={known.length < 2}
        onClick={() => select("both")}
      >
        <span className="tab-name">Both</span>
      </button>
      {tab("left")}
      {tab("right")}
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
  const previewClass = tile.id === "flow" ? "preview-flow" : tile.id === "fire-trail" ? "preview-fire" : "preview-other";

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

function CalibrateHint({ view, names }: { view: RemoteView; names: (sides: Side[]) => string }) {
  if (view.uncalibrated.length === 0) return <span className="card-hint">Neutral set</span>;
  return (
    <span className="card-hint">
      <span className="dot dot-wait" aria-hidden="true" />
      {names(view.uncalibrated)} not set
    </span>
  );
}

function Banners({ view, names }: { view: RemoteView; names: (sides: Side[]) => string }) {
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
  if (banners.length === 0) return null;
  return (
    <div className="banners">
      {banners.map((banner) => (
        <p key={banner.text} className={`banner banner-${banner.tone}`} role="status">
          {banner.text}
        </p>
      ))}
    </div>
  );
}
