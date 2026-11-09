/**
 * Blocks for Storybook's Design system pages. Each one reads token values from the running
 * page, so a page always shows what tokens.css says now. Storybook only.
 */

import type { ReactNode } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { COLOR_GROUPS, TYPE_TOKENS, type TokenDoc } from "../tokens";
import "./docs.css";

/** A token's value as the page computes it, with any var() inside it resolved. */
export function tokenValue(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function hexToRgb(hex: string): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return undefined;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The WCAG contrast ratio between two solid hex colors, or undefined for anything else. */
export function contrast(foreground: string, background: string): number | undefined {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  if (!fg || !bg) return undefined;
  const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function Grade({ ratio }: { ratio: number | undefined }) {
  if (ratio === undefined) return <span className="ds-meta">—</span>;
  const text = ratio.toFixed(1);
  if (ratio >= 4.5) return <span className="ds-pass">{text} · AA</span>;
  if (ratio >= 3) return <span className="ds-near">{text} · large text only</span>;
  return <span className="ds-fail">{text} · too low for text</span>;
}

const TEXT_ON_NIGHT = new Set(["Ink", "Ember", "Status", "Strip"]);

/** Every color, grouped, with its value, what it's for, and how it reads on the page. */
export function ColorGroups() {
  const night = tokenValue("--night");
  return (
    <div className="ds sb-unstyled">
      {COLOR_GROUPS.map((group) => (
        <section key={group.title} className="ds-panel">
          <h3 className="ds-group-title">{group.title}</h3>
          <p className="ds-lead">{group.lead}</p>
          <div className="ds-swatches">
            {group.tokens.map((token) => {
              const value = tokenValue(token.name);
              return (
                <div key={token.name} className="ds-swatch">
                  <div className="ds-chip" style={{ background: `var(${token.name})` }} />
                  <span className="ds-name">{token.name}</span>
                  <span className="ds-value">{value}</span>
                  <span className="ds-meta">{token.use}</span>
                  {TEXT_ON_NIGHT.has(group.title) && (
                    <span className="ds-meta">On night: <Grade ratio={contrast(value, night)} /></span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

const TEXT_COLORS = ["--ink", "--ink-quiet", "--ink-faint", "--ember", "--good", "--wait", "--bad"];
const GROUNDS = ["--night", "--surface", "--surface-raised"];

/** Each text color on each ground, graded against WCAG 2.2 AA. */
export function ContrastTable() {
  return (
    <div className="ds sb-unstyled">
      <div className="ds-panel">
        <table className="ds-table">
          <thead>
            <tr>
              <th>Text</th>
              {GROUNDS.map((ground) => <th key={ground}>On {ground}</th>)}
            </tr>
          </thead>
          <tbody>
            {TEXT_COLORS.map((text) => (
              <tr key={text}>
                <td><span style={{ color: `var(${text})` }}>{text}</span></td>
                {GROUNDS.map((ground) => (
                  <td key={ground}><Grade ratio={contrast(tokenValue(text), tokenValue(ground))} /></td>
                ))}
              </tr>
            ))}
            <tr>
              <td><span style={{ color: "var(--night)", background: "var(--ember)", padding: "2px 6px", borderRadius: 4 }}>--night</span></td>
              <td colSpan={3}>On --ember, for a primary button: <Grade ratio={contrast(tokenValue("--night"), tokenValue("--ember"))} /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The lit color each glow surrounds. */
const GLOW_SOURCE: Record<string, string> = {
  "--glow-good": "--good",
  "--glow-ring": "--led-ring",
  "--glow-toe": "--led-toe",
  "--glow-heel": "--led-heel",
};

export type SampleKind ="glow" | "shadow" | "preview" | "space" | "radius" | "size" | "motion" | "font";

function Sample({ kind, name }: { kind: SampleKind; name: string }) {
  const v = `var(${name})`;
  switch (kind) {
    case "glow":
      return <span className="ds-lit" style={{ background: `var(${GLOW_SOURCE[name] ?? "--ember"})`, boxShadow: `0 0 10px ${v}` }} />;
    case "shadow":
      return <div className="ds-box" style={{ borderRadius: "var(--radius-md)", boxShadow: v }} />;
    case "preview":
      return <div className="ds-strip" style={{ backgroundImage: v }} />;
    case "space":
      return <div className="ds-bar" style={{ width: v }} />;
    case "radius":
      return <div className="ds-box" style={{ borderRadius: v }} />;
    case "size":
      return <div className="ds-box" style={{ width: `min(${v}, 120px)`, height: "var(--target)", borderRadius: "var(--radius-md)" }} />;
    case "font":
      return <span style={{ fontFamily: v, fontSize: "var(--text-card)", textTransform: name === "--display" ? "uppercase" : "none" }}>Aa 0123</span>;
    case "motion":
      return null;
  }
}

/** A table of tokens: name, value, what it's for, and a small sample. */
export function TokenTable({ tokens, kind }: { tokens: TokenDoc[]; kind: SampleKind }) {
  return (
    <div className="ds sb-unstyled">
      <div className="ds-panel">
        <table className="ds-table">
          <thead>
            <tr><th>Token</th><th>Value</th><th>Use</th>{kind !== "motion" && <th>Sample</th>}</tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr key={token.name}>
                <td className="ds-name">{token.name}</td>
                <td className="ds-value">{tokenValue(token.name)}</td>
                <td>{token.use}</td>
                {kind !== "motion" && <td className="ds-sample-cell"><Sample kind={kind} name={token.name} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Every type size, largest first, set in its own face. */
export function TypeScale() {
  return (
    <div className="ds sb-unstyled">
      <div className="ds-panel">
        <table className="ds-table">
          <thead>
            <tr><th>Token</th><th>Size</th><th>Sample</th><th>Use</th></tr>
          </thead>
          <tbody>
            {TYPE_TOKENS.map((token) => (
              <tr key={token.name}>
                <td className="ds-name">{token.name}</td>
                <td className="ds-value">{tokenValue(token.name)}</td>
                <td style={{ maxWidth: 320 }}>
                  <p className={`ds-type-sample ds-type-${token.face}`} style={{ fontSize: `var(${token.name})` }}>{token.sample}</p>
                </td>
                <td>
                  {token.use}
                  <div className="ds-meta">{token.usedBy}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ICONS: { name: IconName; use: string }[] = [
  { name: "remote", use: "The Remote tab" },
  { name: "boots", use: "The Boots tab" },
  { name: "usb", use: "Connect with a cable" },
  { name: "bluetooth", use: "Connect wirelessly" },
  { name: "plus", use: "Add a boot" },
];

/** Every icon the app draws, at the size it's used. */
export function IconGallery() {
  return (
    <div className="ds sb-unstyled">
      <div className="ds-icons">
        {ICONS.map((icon) => (
          <div key={icon.name} className="ds-icon">
            <Icon name={icon.name} size={24} />
            <span className="ds-name">{icon.name}</span>
            <span className="ds-meta">{icon.use}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A pair of right and wrong examples. */
export function DoDont({ good, bad }: { good: ReactNode; bad: ReactNode }) {
  return (
    <div className="ds sb-unstyled">
      <div className="ds-do-dont">
        <div className="ds-do"><strong>Do</strong>{good}</div>
        <div className="ds-dont"><strong>Don't</strong>{bad}</div>
      </div>
    </div>
  );
}

/** Lays a live component out the way the phone shows it, on the page's own ground. */
export function Specimen({ children }: { children: ReactNode }) {
  return (
    <div className="ds sb-unstyled">
      <div className="ds-panel">
        <div className="ds-specimen">{children}</div>
      </div>
    </div>
  );
}
