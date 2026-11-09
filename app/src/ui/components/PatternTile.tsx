/**
 * One pattern on the Remote. The strip along its bottom hints at the pattern's family, the
 * badges name the boots running it, and the hint turns yellow when a boot needs an update to
 * run it. A running tile is lit with ember. Tapping it asks the chosen boots to run it.
 */

export type PatternPreview = "flow" | "fire" | "other";

export interface PatternTileProps {
  name: string;
  /** A short line under the name: what the pattern does, or what a boot needs to run it. */
  hint?: string;
  /** Shows the hint as a warning, such as "Right needs update". */
  hintWarn?: boolean;
  /** Whether any chosen boot is running it now. */
  running: boolean;
  /** One short badge per boot running it, such as "L" and "R". */
  badges?: string[];
  preview: PatternPreview;
  disabled?: boolean;
  onSelect: () => void;
}

export function PatternTile({ name, hint, hintWarn, running, badges = [], preview, disabled, onSelect }: PatternTileProps) {
  return (
    <button type="button" className={`tile${running ? " tile-on" : ""}`} aria-pressed={running} disabled={disabled} onClick={onSelect}>
      <span className="tile-head">
        <span className="tile-name">{name}</span>
        <span className="tile-badges">
          {badges.map((badge) => (
            <span key={badge} className="badge">{badge}</span>
          ))}
        </span>
      </span>
      {hint && <span className={`tile-hint${hintWarn ? " tile-hint-warn" : ""}`}>{hint}</span>}
      <span className={`tile-preview preview-${preview}`} aria-hidden="true" />
    </button>
  );
}
