/// <reference types="node" />
import { readFileSync } from "node:fs";
import { ALL_TOKENS } from "./stories/tokens";

// Read as text: Vitest stubs CSS imports out, even with ?raw.
const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
const tokens = read("./tokens.css");
const styles = read("./styles.css");

const declared = (css: string) => [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1]);

describe("design tokens", () => {
  it("documents every token tokens.css declares, and nothing else", () => {
    const inCss = declared(tokens).sort();
    const documented = ALL_TOKENS.map((token) => token.name).sort();
    expect(documented).toEqual(inCss);
  });

  it("declares each token once", () => {
    const names = declared(tokens);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps raw colors out of styles.css, so every color has a name", () => {
    // Raw colors belong in tokens.css. Component variables such as --pixel point at tokens.
    expect(styles.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? []).toEqual([]);
  });

  it("uses only tokens that exist", () => {
    // PixelSlider sets these two per element, from its own measurements.
    const setInline = ["--zone-gap", "--mark-x"];
    const known = new Set([...declared(tokens), ...declared(styles), ...setInline]);
    const used = [...styles.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]);
    expect(used.filter((name) => !known.has(name))).toEqual([]);
  });
});
