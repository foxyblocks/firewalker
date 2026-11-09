/**
 * The home screen: choose Both, Left, or Right, then control them. Patterns take the
 * middle of the screen and scroll, while brightness and power stay pinned in a dock at the
 * bottom. So however many patterns a boot has, your thumb always knows where those are.
 * All the numbers come from `store.view()`, which shows what the boots reported, plus any
 * tap still on its way.
 *
 * The brightness percent is a share of what the boots accept right now, so it reads 100%
 * at the soft cap while the cap is on, and the same level reads 38% with it off (96 of 255).
 * The cap's toggle sits beside the percent. With the cap off, the slider outlines the levels
 * past the cap, because a full-white strip can then draw more than USB supplies, and the
 * outline's warning sign says so on a tap. Audio tuning sits just above brightness, for one
 * boot's microphone at a time (AudioSetup.tsx). Each boot's calibration, status, and debug
 * output live on its own screen under the app's Boots tab. The app frame owns main navigation.
 */

import { SIDE_NAMES, type BootsStore, type PatternTile, type RemoteView, type Side, type Target } from "../core/boots";
import { patternDisplay } from "../core/patternNames";
import { AudioPanel } from "./AudioSetup";
import { Segmented } from "./components/Segmented";
import { joinNames, LinkDot, PixelSlider, SideBadge, Toggle, type SliderWarning } from "./parts";

const CAP_OFF_MESSAGE = "Past this line, full white can draw more than USB gives, about 1 A.";

export function Remote({ store, onBoots }: { store: BootsStore; onBoots: () => void }) {
  const view = store.view();
  const names = (sides: Side[]) => joinNames(sides.map((side) => store.displayName(side)));
  const percent = view.maxBrightness > 0 ? Math.round((view.brightness / view.maxBrightness) * 100) : 0;
  // Shown while any chosen boot is uncapped. When another chosen boot still has its cap on, the
  // slider stops at that cap, so there's nothing past it to mark.
  const capWarning: SliderWarning | undefined =
    view.capped === false && view.capBrightness !== undefined
      ? { above: view.capBrightness, label: "About the brightness cap", message: CAP_OFF_MESSAGE }
      : undefined;

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

      <footer className="dock">
        <AudioPanel store={store} />
        <div className="section-head">
          <span className="section-label">Brightness</span>
          <span className="brightness-head">
            <span className="readout">{view.controllable ? `${percent}%` : "--"}</span>
            {view.capped !== undefined && (
              <span className="cap-control">
                <span className="cap-label" aria-hidden="true">
                  Cap
                </span>
                <Toggle
                  on={view.capped}
                  label="Brightness cap"
                  small
                  disabled={!view.controllable}
                  onChange={(on) => store.setCap(on)}
                />
              </span>
            )}
          </span>
        </div>
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
        <div className="dock-row">
          <div className="dock-card">
            <span className="card-name">{view.controllable ? `Lights ${view.on ? "on" : "off"}` : "Lights —"}</span>
            <Toggle
              on={view.on}
              label="Lights"
              disabled={!view.controllable}
              onChange={(on) => store.setPower(on)}
            />
          </div>
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
