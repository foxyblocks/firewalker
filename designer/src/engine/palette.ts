// Palette sampling. A palette is a list of evenly spaced color stops, read either as a loop
// (fill layers, so they can scroll forever) or start to end (everything else: a trail's head
// to tail, a flash's start to end).

export type Rgb = [number, number, number];

export function parseColor(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match || !match[1]) return [0, 0, 0];
  const n = parseInt(match[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function parsePalette(colors: readonly string[]): Rgb[] {
  return colors.map(parseColor);
}

// Writes the color at u into out[at..at+2]. Looping: stop k sits at k/n and the last stop
// blends back into the first, so u and u+1 are the same color. Start to end: the first stop
// is at 0, the last at 1, and u is clamped.
export function samplePalette(stops: readonly Rgb[], u: number, loop: boolean, out: Float32Array, at: number): void {
  const n = stops.length;
  if (n === 0) {
    out[at] = out[at + 1] = out[at + 2] = 0;
    return;
  }
  let a: Rgb;
  let b: Rgb;
  let f: number;
  if (n === 1) {
    a = b = stops[0]!;
    f = 0;
  } else if (loop) {
    const x = (u - Math.floor(u)) * n;
    const i = Math.floor(x) % n;
    a = stops[i]!;
    b = stops[(i + 1) % n]!;
    f = x - Math.floor(x);
  } else {
    const x = Math.min(1, Math.max(0, u)) * (n - 1);
    const i = Math.min(n - 2, Math.floor(x));
    a = stops[i]!;
    b = stops[i + 1]!;
    f = x - i;
  }
  out[at] = a[0] + (b[0] - a[0]) * f;
  out[at + 1] = a[1] + (b[1] - a[1]) * f;
  out[at + 2] = a[2] + (b[2] - a[2]) * f;
}
