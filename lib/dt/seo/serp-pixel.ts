/**
 * SERP Pixel-Checker für Title / Meta-Description.
 *
 * Ohne stabile Google-HTML-Referenz nutzen wir branchenübliche Defaults
 * (Arial-Metriken, wie in gängigen SERP-Snippets):
 * - Title Desktop: Arial 20px → Limit ~600px
 * - Title Mobile:  Arial 16px → Limit ~440px
 * - Description:   Arial 14px → Limit ~920px (Desktop/Mobile gleich)
 *
 * Messung: gewichtete Zeichenbreiten (Server/n8n-fähig). Im Browser kann
 * optional `measureSerpTextCanvas` mit `canvas.measureText` genutzt werden.
 * Zeichenzahl ist nur Zusatzinfo — entscheidend sind die Pixel.
 */

export const SERP_PIXEL_LIMITS = {
  titleDesktop: 600,
  titleMobile: 440,
  description: 920,
} as const;

/** Approximate Arial advance widths at 1px em — scaled by font size. */
const ARIAL_UNIT_WIDTHS: Record<string, number> = {
  " ": 0.25,
  i: 0.28,
  l: 0.28,
  I: 0.28,
  j: 0.28,
  t: 0.35,
  f: 0.35,
  r: 0.38,
  "!": 0.33,
  ".": 0.28,
  ",": 0.28,
  ":": 0.28,
  ";": 0.28,
  "'": 0.22,
  '"': 0.35,
  "(": 0.33,
  ")": 0.33,
  "-": 0.33,
  "–": 0.5,
  "—": 0.75,
  a: 0.56,
  b: 0.56,
  c: 0.5,
  d: 0.56,
  e: 0.56,
  g: 0.56,
  h: 0.56,
  k: 0.5,
  n: 0.56,
  o: 0.56,
  p: 0.56,
  q: 0.56,
  s: 0.5,
  u: 0.56,
  v: 0.5,
  x: 0.5,
  y: 0.5,
  z: 0.5,
  A: 0.67,
  B: 0.67,
  C: 0.72,
  D: 0.72,
  E: 0.67,
  F: 0.61,
  G: 0.78,
  H: 0.72,
  J: 0.5,
  K: 0.67,
  L: 0.56,
  N: 0.72,
  O: 0.78,
  P: 0.67,
  Q: 0.78,
  R: 0.72,
  S: 0.67,
  T: 0.61,
  U: 0.72,
  V: 0.67,
  X: 0.67,
  Y: 0.67,
  Z: 0.61,
  m: 0.83,
  w: 0.78,
  M: 0.83,
  W: 0.94,
  "0": 0.56,
  "1": 0.56,
  "2": 0.56,
  "3": 0.56,
  "4": 0.56,
  "5": 0.56,
  "6": 0.56,
  "7": 0.56,
  "8": 0.56,
  "9": 0.56,
  ä: 0.56,
  ö: 0.56,
  ü: 0.56,
  Ä: 0.67,
  Ö: 0.78,
  Ü: 0.72,
  ß: 0.61,
  "&": 0.67,
  "?": 0.56,
  "/": 0.28,
  "|": 0.26,
};

const DEFAULT_UNIT_WIDTH = 0.56;

export function estimateArialPixelWidth(text: string, fontSizePx: number): number {
  let units = 0;
  for (const ch of text) {
    units += ARIAL_UNIT_WIDTHS[ch] ?? DEFAULT_UNIT_WIDTH;
  }
  return Math.round(units * fontSizePx);
}

export type SerpFieldCheck = {
  text: string;
  chars: number;
  desktopPx: number;
  mobilePx: number;
  desktopLimit: number;
  mobileLimit: number;
  desktopOk: boolean;
  mobileOk: boolean;
};

export type SerpSnippetCheck = {
  title: SerpFieldCheck | null;
  description: SerpFieldCheck | null;
};

function checkTitle(text: string): SerpFieldCheck {
  const desktopPx = estimateArialPixelWidth(text, 20);
  const mobilePx = estimateArialPixelWidth(text, 16);
  return {
    text,
    chars: text.length,
    desktopPx,
    mobilePx,
    desktopLimit: SERP_PIXEL_LIMITS.titleDesktop,
    mobileLimit: SERP_PIXEL_LIMITS.titleMobile,
    desktopOk: desktopPx <= SERP_PIXEL_LIMITS.titleDesktop,
    mobileOk: mobilePx <= SERP_PIXEL_LIMITS.titleMobile,
  };
}

function checkDescription(text: string): SerpFieldCheck {
  const px = estimateArialPixelWidth(text, 14);
  return {
    text,
    chars: text.length,
    desktopPx: px,
    mobilePx: px,
    desktopLimit: SERP_PIXEL_LIMITS.description,
    mobileLimit: SERP_PIXEL_LIMITS.description,
    desktopOk: px <= SERP_PIXEL_LIMITS.description,
    mobileOk: px <= SERP_PIXEL_LIMITS.description,
  };
}

export function checkSerpSnippet(input: {
  title?: string | null;
  description?: string | null;
}): SerpSnippetCheck {
  const title = input.title?.trim() || "";
  const description = input.description?.trim() || "";
  return {
    title: title ? checkTitle(title) : null,
    description: description ? checkDescription(description) : null,
  };
}

function formatField(label: string, field: SerpFieldCheck): string {
  const desk = field.desktopOk
    ? `Desktop OK (${field.desktopPx}/${field.desktopLimit}px)`
    : `Desktop ZU LANG (${field.desktopPx}/${field.desktopLimit}px, +${field.desktopPx - field.desktopLimit}px)`;
  const mob = field.mobileOk
    ? `Mobile OK (${field.mobilePx}/${field.mobileLimit}px)`
    : `Mobile ZU LANG (${field.mobilePx}/${field.mobileLimit}px, +${field.mobilePx - field.mobileLimit}px)`;
  return [
    `${label}: „${field.text}"`,
    `  Zeichen: ${field.chars} (nur Zusatz — Pixel entscheiden)`,
    `  ${desk}`,
    `  ${mob}`,
  ].join("\n");
}

export function formatSerpSnippetCheckForTool(input: {
  title?: string | null;
  description?: string | null;
}): string {
  const title = input.title?.trim() || "";
  const description = input.description?.trim() || "";
  if (!title && !description) {
    return "Bitte title und/oder description angeben.";
  }

  const checked = checkSerpSnippet({ title, description });
  const lines = [
    "SERP-Pixel-Check (Arial-Schätzung, Limits: Title 600/440px, Description 920px):",
  ];
  if (checked.title) lines.push(formatField("Title", checked.title));
  if (checked.description) lines.push(formatField("Meta-Description", checked.description));

  const problems: string[] = [];
  if (checked.title && !checked.title.desktopOk) problems.push("Title Desktop kürzen");
  if (checked.title && !checked.title.mobileOk) problems.push("Title Mobile kürzen");
  if (checked.description && !checked.description.desktopOk) {
    problems.push("Description kürzen");
  }
  if (problems.length === 0) {
    lines.push("Ergebnis: alle geprüften Felder innerhalb der Pixel-Limits.");
  } else {
    lines.push(`Ergebnis: Anpassen — ${problems.join("; ")}.`);
  }
  return lines.join("\n");
}

/**
 * Optional browser helper using canvas.measureText with Arial.
 * Falls back to the character-width estimator when canvas is unavailable.
 */
export function measureSerpTextCanvas(
  text: string,
  fontSizePx: number,
  fontFamily = "Arial, sans-serif",
): number {
  if (typeof document === "undefined") {
    return estimateArialPixelWidth(text, fontSizePx);
  }
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return estimateArialPixelWidth(text, fontSizePx);
    ctx.font = `${fontSizePx}px ${fontFamily}`;
    return Math.round(ctx.measureText(text).width);
  } catch {
    return estimateArialPixelWidth(text, fontSizePx);
  }
}
