/**
 * Colour helpers of the Grounding Page design: parse CSS colours, mix them, WCAG 2.x contrast.
 * Pure and browser-safe (used by the design card's live preview too).
 */

export type Rgba = { r: number; g: number; b: number; a: number };

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  navy: "#000080",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  purple: "#800080",
  teal: "#008080",
  olive: "#808000",
  orange: "#ffa500",
  yellow: "#ffff00",
  darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9",
  dimgray: "#696969",
  dimgrey: "#696969",
  lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3",
  whitesmoke: "#f5f5f5",
  gainsboro: "#dcdcdc",
  darkblue: "#00008b",
  darkred: "#8b0000",
  darkgreen: "#006400",
  crimson: "#dc143c",
  firebrick: "#b22222",
  royalblue: "#4169e1",
  steelblue: "#4682b4",
  slategray: "#708090",
  slategrey: "#708090",
  darkslategray: "#2f4f4f",
  darkslategrey: "#2f4f4f",
  midnightblue: "#191970",
  seagreen: "#2e8b57",
  forestgreen: "#228b22",
  goldenrod: "#daa520",
  tomato: "#ff6347",
  coral: "#ff7f50",
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function channel(value: string, max: number): number | null {
  const v = value.trim();
  if (!v) return null;
  if (v.endsWith("%")) {
    const n = Number(v.slice(0, -1));
    return Number.isFinite(n) ? clamp((n / 100) * max, 0, max) : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, 0, max) : null;
}

function alpha(value: string | undefined): number | null {
  if (value === undefined) return 1;
  const v = value.trim();
  if (v.endsWith("%")) {
    const n = Number(v.slice(0, -1));
    return Number.isFinite(n) ? clamp(n / 100, 0, 1) : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, 0, 1) : null;
}

function hue(value: string): number | null {
  const m = value.trim().match(/^(-?[\d.]+)(deg|turn|rad|grad)?$/i);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "deg").toLowerCase();
  if (unit === "turn") n *= 360;
  else if (unit === "rad") n = (n * 180) / Math.PI;
  else if (unit === "grad") n *= 0.9;
  return ((n % 360) + 360) % 360;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Arguments of rgb()/hsl(): commas or spaces, optional „/ alpha“. */
function args(inner: string): string[] {
  const [main, slashAlpha] = inner.split("/");
  const parts = main!.includes(",") ? main!.split(",") : main!.trim().split(/\s+/);
  const out = parts.map((p) => p.trim()).filter(Boolean);
  if (slashAlpha !== undefined) out.push(slashAlpha.trim());
  return out;
}

/**
 * A CSS colour as RGBA, or null for anything else (gradients, `currentColor`, `inherit`,
 * `transparent`, var() …). `bareHsl` also accepts shadcn-style triplets („222 47% 11%“).
 */
export function parseColor(raw: string | null | undefined, opts: { bareHsl?: boolean } = {}): Rgba | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase().replace(/\s*!important$/, "");
  if (!value) return null;
  const named = NAMED[value];
  if (named) return parseColor(named);

  const hex = value.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const h = hex[1]!;
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = h.split("").map((c) => parseInt(c + c, 16));
      return { r: r!, g: g!, b: b!, a: a === undefined ? 1 : a / 255 };
    }
    if (h.length === 6 || h.length === 8) {
      const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
      return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
    }
    return null;
  }

  const fn = value.match(/^(rgba?|hsla?)\(([^()]*)\)$/);
  if (fn) {
    const parts = args(fn[2]!);
    if (parts.length < 3 || parts.length > 4) return null;
    const a = alpha(parts[3]);
    if (a === null) return null;
    if (fn[1]!.startsWith("rgb")) {
      const [r, g, b] = parts.slice(0, 3).map((p) => channel(p, 255));
      if (r == null || g == null || b == null) return null;
      return { r, g, b, a };
    }
    const h = hue(parts[0]!);
    const s = channel(parts[1]!.endsWith("%") ? parts[1]! : `${parts[1]}%`, 1);
    const l = channel(parts[2]!.endsWith("%") ? parts[2]! : `${parts[2]}%`, 1);
    if (h == null || s == null || l == null) return null;
    const [r, g, b] = hslToRgb(h, s, l);
    return { r, g, b, a };
  }

  if (opts.bareHsl) {
    const triplet = value.match(/^(-?[\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+%?))?$/);
    if (triplet) return parseColor(`hsl(${triplet[1]} ${triplet[2]}% ${triplet[3]}%${triplet[4] ? ` / ${triplet[4]}` : ""})`);
  }
  return null;
}

export function toHex(c: Pick<Rgba, "r" | "g" | "b">): string {
  const h = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** „#RGB“, „#RRGGBB“ or any parseable colour → lowercase „#rrggbb“ (alpha dropped). Null if invalid. */
export function normalizeHex(raw: string | null | undefined): string | null {
  const c = parseColor(raw);
  return c ? toHex(c) : null;
}

/** Colour with alpha painted over an opaque background. */
export function blendOver(fg: Rgba, bg: Pick<Rgba, "r" | "g" | "b">): Rgba {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

/** `amount` 0 → a, 1 → b. */
export function mix(a: string, b: string, amount: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return a;
  const t = clamp(amount, 0, 1);
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

function linear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: string): number {
  const c = parseColor(color);
  if (!c) return 0;
  return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

/** WCAG 2.x contrast ratio (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function roundRatio(ratio: number): string {
  return (Math.floor(ratio * 10) / 10).toFixed(1).replace(".", ",");
}

/**
 * The colour nudged towards black or white (whichever contrasts more with `bg`) until the
 * ratio is reached. Keeps the hue as long as possible; always succeeds for ratios ≤ 4.5.
 */
export function ensureContrast(fg: string, bg: string, min: number): { color: string; adjusted: boolean; before: number; after: number } {
  const before = contrastRatio(fg, bg);
  if (before >= min) return { color: normalizeHex(fg) ?? fg, adjusted: false, before, after: before };
  const target = contrastRatio("#000000", bg) >= contrastRatio("#ffffff", bg) ? "#000000" : "#ffffff";
  for (let step = 1; step <= 20; step++) {
    const candidate = mix(fg, target, step / 20);
    const ratio = contrastRatio(candidate, bg);
    if (ratio >= min) return { color: candidate, adjusted: true, before, after: ratio };
  }
  return { color: target, adjusted: true, before, after: contrastRatio(target, bg) };
}

/** HSL saturation and lightness (0–1), for telling brand colours from greys. */
export function saturationLightness(color: string): { s: number; l: number } {
  const c = parseColor(color);
  if (!c) return { s: 0, l: 0 };
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

/** Greys, near-white and near-black: never an accent. */
export function isNeutralColor(color: string): boolean {
  const { s, l } = saturationLightness(color);
  return s < 0.15 || l > 0.94 || l < 0.08;
}

export function isLightColor(color: string): boolean {
  return relativeLuminance(color) > 0.4;
}
