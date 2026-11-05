/**
 * Design profile of an organisation's Grounding Pages: colours, fonts and heading style of
 * the client's website (table dt_grounding_design, migration 20261105_dt_grounding_design.sql).
 *
 * Storage keeps two layers per organisation:
 * - `detected`: the last automatic detection (replaced as a whole by every detection);
 * - `manual`: values a person set in the Grounding tab (never touched by a detection).
 * A field's value is `manual ?? detected`, so manual values always win and a new detection
 * only changes fields without a manual value („auto“). `enabled = false` („Auf Standard
 * zurücksetzen“) renders the neutral template until someone saves or detects again.
 * Pure and browser-safe.
 */

import { contrastRatio, ensureContrast, mix, normalizeHex, roundRatio } from "@/lib/dt/seo/grounding-design/color";
import {
  NEUTRAL_FONT_STACK,
  SYSTEM_STACKS,
  type SystemStackKey,
  buildFontStack,
  isGenericFamily,
  parseFontFamilyList,
  sanitizeFamilyName,
} from "@/lib/dt/seo/grounding-design/fonts";

export const DESIGN_COLOR_KEYS = ["text", "background", "heading", "link", "accent", "muted"] as const;
export type DesignColorKey = (typeof DESIGN_COLOR_KEYS)[number];

export const DESIGN_FONT_ROLES = ["body", "heading"] as const;
export type DesignFontRole = (typeof DESIGN_FONT_ROLES)[number];

export const DESIGN_COLOR_LABELS: Record<DesignColorKey, { label: string; hint: string }> = {
  text: { label: "Text", hint: "Fließtext" },
  background: { label: "Hintergrund", hint: "Seitenhintergrund" },
  heading: { label: "Überschriften", hint: "H1 bis H3" },
  link: { label: "Links", hint: "Verweise im Text" },
  accent: { label: "Akzent", hint: "Linien und Hervorhebungen" },
  muted: { label: "Gedämpft", hint: "Kleiner Text und Linien" },
};

export type DesignSource = "auto" | "manuell";
export type GroundingFontSource = "self-hosted" | "external" | "system";

export type GroundingFontFace = {
  /** Absolute URL on the client's own origin. */
  url: string;
  format: "woff2" | "woff";
  /** „400“, „700“ or a range „100 900“ (variable fonts). */
  weight: string;
  style: "normal" | "italic";
};

export type GroundingFont = {
  name: string;
  css_stack: string;
  source: GroundingFontSource;
  /** Only for source „self-hosted“: the @font-face files on the client's domain. */
  font_face_urls?: GroundingFontFace[];
};

export type DesignTypography = {
  headingWeight?: number;
  /** CSS letter-spacing of headings, e.g. „0.02em“. */
  headingLetterSpacing?: string;
  headingUppercase?: boolean;
  /** Base font size in px. */
  baseFontSize?: number;
};

export type DesignValues = {
  colors: Partial<Record<DesignColorKey, string>>;
  fonts: Partial<Record<DesignFontRole, GroundingFont>>;
  typography: DesignTypography;
};

export type DetectedDesign = DesignValues & {
  /** German notes for the UI: contrast fixes, external fonts, what was not found. */
  notes: string[];
};

export type GroundingDesignRecord = {
  enabled: boolean;
  detected: DetectedDesign | null;
  manual: DesignValues;
  detectedAt: string | null;
  detectedFromUrl: string | null;
};

export type DesignField<T> = { value: T; source: DesignSource };

/** The merged view the API and the UI work with: every field with its source. */
export type GroundingDesignProfile = {
  enabled: boolean;
  colors: Partial<Record<DesignColorKey, DesignField<string>>>;
  fonts: Partial<Record<DesignFontRole, DesignField<GroundingFont>>>;
  typography: { [K in keyof DesignTypography]?: DesignField<NonNullable<DesignTypography[K]>> };
  detected_at: string | null;
  detected_from_url: string | null;
  notes: string[];
};

/** Everything the CSS builder needs, no gaps. */
export type ResolvedDesign = {
  colors: Record<DesignColorKey, string>;
  fonts: Record<DesignFontRole, GroundingFont>;
  headingWeight: number;
  headingLetterSpacing: string;
  headingUppercase: boolean;
  /** px; null = browser default. */
  baseFontSize: number | null;
};

export const NEUTRAL_FONT: GroundingFont = { name: "Systemschrift", css_stack: NEUTRAL_FONT_STACK, source: "system" };

/** Values of the neutral template (#1b1f24 on white, system font). */
export const NEUTRAL_DESIGN: ResolvedDesign = {
  colors: {
    text: "#1b1f24",
    background: "#ffffff",
    heading: "#1b1f24",
    link: "#1d4ed8",
    accent: "#1d4ed8",
    muted: "#4b5563",
  },
  fonts: { body: NEUTRAL_FONT, heading: NEUTRAL_FONT },
  headingWeight: 700,
  headingLetterSpacing: "normal",
  headingUppercase: false,
  baseFontSize: null,
};

export const EMPTY_DESIGN_VALUES: DesignValues = { colors: {}, fonts: {}, typography: {} };

// --- sanitising (stored JSON, API input) ---------------------------------------------------------

const LETTER_SPACING = /^(normal|-?(?:\d{1,2}(?:\.\d{1,3})?|\.\d{1,3})(?:em|rem|px))$/;

export function sanitizeLetterSpacing(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!LETTER_SPACING.test(v)) return null;
  if (v === "normal") return v;
  const n = Number.parseFloat(v);
  const max = v.endsWith("px") ? 6 : 0.4;
  if (Math.abs(n) > max) return null;
  return v.replace(/^(-?)\./, "$10.").replace(/^(-?)0+(\d)/, "$1$2");
}

export function sanitizeHeadingWeight(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const rounded = Math.round(n / 100) * 100;
  return rounded >= 100 && rounded <= 900 ? rounded : null;
}

export function sanitizeBaseFontSize(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const r = Math.round(n * 10) / 10;
  return r >= 12 && r <= 24 ? r : null;
}

/** https URL without characters that could leave a CSS url("…"). */
export function sanitizeFontUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!/^https:\/\//i.test(v) || /["'()\\\s<>]/.test(v) || v.length > 500) return null;
  try {
    const u = new URL(v);
    if (!/\.(woff2?)$/i.test(u.pathname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function sanitizeFace(raw: unknown): GroundingFontFace | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const url = sanitizeFontUrl(f.url);
  if (!url) return null;
  const format = f.format === "woff" ? "woff" : f.format === "woff2" ? "woff2" : /\.woff$/i.test(url) ? "woff" : "woff2";
  const weight = typeof f.weight === "string" && /^\d{3}( \d{3})?$/.test(f.weight.trim()) ? f.weight.trim() : "400";
  const style = f.style === "italic" ? "italic" : "normal";
  return { url, format, weight, style };
}

export function sanitizeFont(raw: unknown): GroundingFont | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const name = sanitizeFamilyName(typeof f.name === "string" ? f.name : "");
  const stack = buildFontStack(parseFontFamilyList(typeof f.css_stack === "string" ? f.css_stack : ""));
  if (!name || !stack) return null;
  const source: GroundingFontSource = f.source === "self-hosted" || f.source === "external" ? f.source : "system";
  const faces = source === "self-hosted" && Array.isArray(f.font_face_urls)
    ? f.font_face_urls.map(sanitizeFace).filter((x): x is GroundingFontFace => Boolean(x)).slice(0, 4)
    : [];
  if (source === "self-hosted" && faces.length === 0) return { name, css_stack: stack, source: "system" };
  return faces.length > 0 ? { name, css_stack: stack, source, font_face_urls: faces } : { name, css_stack: stack, source };
}

/** Stored or posted values → only what is valid; invalid fields are dropped, never thrown. */
export function sanitizeDesignValues(raw: unknown): DesignValues {
  const out: DesignValues = { colors: {}, fonts: {}, typography: {} };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const colors = (r.colors && typeof r.colors === "object" ? r.colors : {}) as Record<string, unknown>;
  for (const key of DESIGN_COLOR_KEYS) {
    const hex = typeof colors[key] === "string" ? normalizeHex(colors[key] as string) : null;
    if (hex) out.colors[key] = hex;
  }
  const fonts = (r.fonts && typeof r.fonts === "object" ? r.fonts : {}) as Record<string, unknown>;
  for (const role of DESIGN_FONT_ROLES) {
    const font = sanitizeFont(fonts[role]);
    if (font) out.fonts[role] = font;
  }
  const t = (r.typography && typeof r.typography === "object" ? r.typography : {}) as Record<string, unknown>;
  const weight = sanitizeHeadingWeight(t.headingWeight);
  if (weight !== null) out.typography.headingWeight = weight;
  const spacing = sanitizeLetterSpacing(t.headingLetterSpacing);
  if (spacing !== null) out.typography.headingLetterSpacing = spacing;
  if (typeof t.headingUppercase === "boolean") out.typography.headingUppercase = t.headingUppercase;
  const size = sanitizeBaseFontSize(t.baseFontSize);
  if (size !== null) out.typography.baseFontSize = size;
  return out;
}

export function sanitizeDetectedDesign(raw: unknown): DetectedDesign | null {
  if (!raw || typeof raw !== "object") return null;
  const notes = Array.isArray((raw as { notes?: unknown }).notes)
    ? ((raw as { notes: unknown[] }).notes.filter((n) => typeof n === "string") as string[]).map((n) => n.slice(0, 400)).slice(0, 20)
    : [];
  return { ...sanitizeDesignValues(raw), notes };
}

export function hasDesignValues(values: DesignValues | null | undefined): boolean {
  if (!values) return false;
  return Object.keys(values.colors).length + Object.keys(values.fonts).length + Object.keys(values.typography).length > 0;
}

// --- layers ---------------------------------------------------------------------------------------

/** manual over detected, field by field. */
export function mergeDesignValues(detected: DesignValues | null, manual: DesignValues | null): DesignValues {
  const d = detected ?? EMPTY_DESIGN_VALUES;
  const m = manual ?? EMPTY_DESIGN_VALUES;
  return {
    colors: { ...d.colors, ...m.colors },
    fonts: { ...d.fonts, ...m.fonts },
    typography: { ...d.typography, ...m.typography },
  };
}

/**
 * A new detection: replaces the detected layer, keeps every manual value. `enable` turns the
 * website design back on („Design neu erkennen“); the automatic run keeps the stored choice.
 */
export function applyDetection(
  record: GroundingDesignRecord | null,
  detected: DetectedDesign,
  input: { url: string; at: string; enable?: boolean },
): GroundingDesignRecord {
  return {
    enabled: input.enable ? true : (record?.enabled ?? true),
    detected,
    manual: record?.manual ?? EMPTY_DESIGN_VALUES,
    detectedAt: input.at,
    detectedFromUrl: input.url,
  };
}

export type ManualFontInput = { name: string; stack: SystemStackKey };

/** What the design card saves: a value sets „manuell“, null returns the field to „auto“. */
export type ManualDesignEdit = {
  colors?: Partial<Record<DesignColorKey, string | null>>;
  fonts?: Partial<Record<DesignFontRole, ManualFontInput | null>>;
  typography?: { [K in keyof DesignTypography]?: DesignTypography[K] | null };
};

/** A manual font: the typed name (a local font, nothing is loaded) before a system stack. */
export function manualFont(input: ManualFontInput): GroundingFont | null {
  const stack = SYSTEM_STACKS[input.stack]?.stack;
  if (!stack) return null;
  const name = sanitizeFamilyName(input.name);
  const families = parseFontFamilyList(stack);
  const css = buildFontStack(name && !isGenericFamily(name) && name !== NEUTRAL_FONT.name ? [name, ...families] : families);
  return { name: name || SYSTEM_STACKS[input.stack].label, css_stack: css, source: "system" };
}

export function applyManualEdit(record: GroundingDesignRecord | null, edit: ManualDesignEdit): GroundingDesignRecord {
  const manual: DesignValues = {
    colors: { ...(record?.manual.colors ?? {}) },
    fonts: { ...(record?.manual.fonts ?? {}) },
    typography: { ...(record?.manual.typography ?? {}) },
  };
  for (const key of DESIGN_COLOR_KEYS) {
    if (!edit.colors || !(key in edit.colors)) continue;
    const v = edit.colors[key];
    const hex = v ? normalizeHex(v) : null;
    if (hex) manual.colors[key] = hex;
    else delete manual.colors[key];
  }
  for (const role of DESIGN_FONT_ROLES) {
    if (!edit.fonts || !(role in edit.fonts)) continue;
    const v = edit.fonts[role];
    const font = v ? manualFont(v) : null;
    if (font) manual.fonts[role] = font;
    else delete manual.fonts[role];
  }
  const t = edit.typography ?? {};
  if ("headingWeight" in t) {
    const w = sanitizeHeadingWeight(t.headingWeight);
    if (w !== null) manual.typography.headingWeight = w;
    else delete manual.typography.headingWeight;
  }
  if ("headingLetterSpacing" in t) {
    const s = sanitizeLetterSpacing(t.headingLetterSpacing);
    if (s !== null) manual.typography.headingLetterSpacing = s;
    else delete manual.typography.headingLetterSpacing;
  }
  if ("headingUppercase" in t) {
    if (typeof t.headingUppercase === "boolean") manual.typography.headingUppercase = t.headingUppercase;
    else delete manual.typography.headingUppercase;
  }
  if ("baseFontSize" in t) {
    const s = sanitizeBaseFontSize(t.baseFontSize);
    if (s !== null) manual.typography.baseFontSize = s;
    else delete manual.typography.baseFontSize;
  }
  return {
    enabled: true,
    detected: record?.detected ?? null,
    manual,
    detectedAt: record?.detectedAt ?? null,
    detectedFromUrl: record?.detectedFromUrl ?? null,
  };
}

/** „Auf Standard zurücksetzen“: neutral template, manual values gone, the detection kept. */
export function resetDesign(record: GroundingDesignRecord | null): GroundingDesignRecord {
  return {
    enabled: false,
    detected: record?.detected ?? null,
    manual: EMPTY_DESIGN_VALUES,
    detectedAt: record?.detectedAt ?? null,
    detectedFromUrl: record?.detectedFromUrl ?? null,
  };
}

// --- views ----------------------------------------------------------------------------------------

export function designProfileView(record: GroundingDesignRecord | null): GroundingDesignProfile {
  const detected = record?.detected ?? null;
  const manual = record?.manual ?? EMPTY_DESIGN_VALUES;
  const field = <T,>(m: T | undefined, d: T | undefined): DesignField<T> | undefined =>
    m !== undefined ? { value: m, source: "manuell" } : d !== undefined ? { value: d, source: "auto" } : undefined;
  const view: GroundingDesignProfile = {
    enabled: record?.enabled ?? true,
    colors: {},
    fonts: {},
    typography: {},
    detected_at: record?.detectedAt ?? null,
    detected_from_url: record?.detectedFromUrl ?? null,
    notes: detected?.notes ?? [],
  };
  for (const key of DESIGN_COLOR_KEYS) {
    const f = field(manual.colors[key], detected?.colors[key]);
    if (f) view.colors[key] = f;
  }
  for (const role of DESIGN_FONT_ROLES) {
    const f = field(manual.fonts[role], detected?.fonts[role]);
    if (f) view.fonts[role] = f;
  }
  const t = view.typography;
  const w = field(manual.typography.headingWeight, detected?.typography.headingWeight);
  if (w) t.headingWeight = w;
  const s = field(manual.typography.headingLetterSpacing, detected?.typography.headingLetterSpacing);
  if (s) t.headingLetterSpacing = s;
  const u = field(manual.typography.headingUppercase, detected?.typography.headingUppercase);
  if (u) t.headingUppercase = u;
  const b = field(manual.typography.baseFontSize, detected?.typography.baseFontSize);
  if (b) t.baseFontSize = b;
  return view;
}

/** Muted colour from text and background when the website names none (AA for small text). */
export function deriveMutedColor(text: string, background: string): string {
  return ensureContrast(mix(text, background, 0.35), background, 4.5).color;
}

/** Fill every gap with the neutral template's values. */
export function resolveDesignValues(values: DesignValues): ResolvedDesign {
  const c = values.colors;
  const text = c.text ?? NEUTRAL_DESIGN.colors.text;
  const background = c.background ?? NEUTRAL_DESIGN.colors.background;
  // Without a link colour links take the accent, made readable as body text (AA 4.5:1).
  const link = c.link ?? (c.accent ? ensureContrast(c.accent, background, 4.5).color : NEUTRAL_DESIGN.colors.link);
  const body = values.fonts.body ?? NEUTRAL_FONT;
  return {
    colors: {
      text,
      background,
      heading: c.heading ?? text,
      link,
      accent: c.accent ?? link,
      muted: c.muted ?? deriveMutedColor(text, background),
    },
    fonts: { body, heading: values.fonts.heading ?? body },
    headingWeight: values.typography.headingWeight ?? NEUTRAL_DESIGN.headingWeight,
    headingLetterSpacing: values.typography.headingLetterSpacing ?? NEUTRAL_DESIGN.headingLetterSpacing,
    headingUppercase: values.typography.headingUppercase ?? NEUTRAL_DESIGN.headingUppercase,
    baseFontSize: values.typography.baseFontSize ?? NEUTRAL_DESIGN.baseFontSize,
  };
}

/**
 * The design to render, or null for today's neutral template: no profile, switched off
 * („Auf Standard zurücksetzen“) or nothing detected.
 */
export function resolveGroundingDesign(record: GroundingDesignRecord | null | undefined): ResolvedDesign | null {
  if (!record || !record.enabled) return null;
  const values = mergeDesignValues(record.detected, record.manual);
  if (!hasDesignValues(values)) return null;
  return resolveDesignValues(values);
}

export type ContrastWarning = { pair: string; ratio: number; min: number; message: string };

/** WCAG AA of the rendered colours (manual values are kept as they are, so they may fail). */
export function designContrastWarnings(design: ResolvedDesign): ContrastWarning[] {
  const bg = design.colors.background;
  const checks: Array<[DesignColorKey, number, string]> = [
    ["text", 4.5, "Text auf Hintergrund"],
    ["link", 4.5, "Links auf Hintergrund"],
    ["muted", 4.5, "Gedämpfter Text auf Hintergrund"],
    ["heading", 3, "Überschriften auf Hintergrund"],
  ];
  const out: ContrastWarning[] = [];
  for (const [key, min, label] of checks) {
    const ratio = contrastRatio(design.colors[key], bg);
    if (ratio < min) {
      out.push({ pair: key, ratio, min, message: `${label}: Kontrast ${roundRatio(ratio)}:1, WCAG AA verlangt ${String(min).replace(".", ",")}:1.` });
    }
  }
  return out;
}
