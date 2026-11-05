/**
 * Deterministic design detection from a homepage's HTML and its same-origin CSS: colours,
 * fonts and heading style for the Grounding Page. No model call, no browser.
 *
 * Order of evidence per field:
 * 1. the website's own rules for body/html, h1–h3 and a (with var() resolved), which is what
 *    a visitor sees on content pages;
 * 2. theme variables of known systems (WordPress theme.json, Elementor globals, Divi,
 *    Bootstrap, Tailwind/shadcn, Astra, Kadence, GeneratePress, Blocksy);
 * 3. for the accent: the most used button background, else a theme accent variable, else the
 *    most frequent brand colour of the CSS.
 * Fonts: only @font-face files on the client's own domain (woff2/woff) are used; anything from
 * Google Fonts, Adobe Fonts or another host maps to the closest system stack. Contrast: text on
 * background must reach WCAG AA (4.5:1) or both fall back to neutral; links and muted text are
 * nudged until they pass; headings below 3:1 take the text colour. The accent stays the brand
 * colour: the page uses it only for decorative lines, never for text.
 * Pure (cheerio for the HTML).
 */

import * as cheerio from "cheerio";

import {
  blendOver,
  contrastRatio,
  ensureContrast,
  isNeutralColor,
  normalizeHex,
  parseColor,
  roundRatio,
  toHex,
} from "@/lib/dt/seo/grounding-design/color";
import {
  type CssFontFaceRule,
  type CssStyleRule,
  parseCss,
  parseFontSrc,
  splitTopLevel,
} from "@/lib/dt/seo/grounding-design/css-parse";
import {
  EXTERNAL_FONT_HOSTS,
  SYSTEM_STACKS,
  buildFontStack,
  familiesFromFontServiceUrl,
  isGenericFamily,
  isIconFont,
  isSystemFamily,
  parseFontFamilyList,
  systemOnlyStack,
  systemStackKeyFor,
} from "@/lib/dt/seo/grounding-design/fonts";
import { absoluteUrl, isOwnOrigin } from "@/lib/dt/seo/grounding-design/origin";
import {
  type DesignColorKey,
  type DetectedDesign,
  type GroundingFont,
  type GroundingFontFace,
  NEUTRAL_DESIGN,
  deriveMutedColor,
  sanitizeBaseFontSize,
  sanitizeDetectedDesign,
  sanitizeHeadingWeight,
  sanitizeLetterSpacing,
} from "@/lib/dt/seo/grounding-design/profile";

export const MAX_STYLESHEETS = 5;
export const MAX_STYLESHEET_BYTES = 300_000;

export type StylesheetLink = { url: string; sameOrigin: boolean; media: string | null };

/** <link rel="stylesheet"> of the page in document order (print-only sheets left out). */
export function stylesheetLinks(html: string, pageUrl: string): StylesheetLink[] {
  const $ = cheerio.load(html);
  const out: StylesheetLink[] = [];
  $("link[href]").each((_, el) => {
    const rel = ($(el).attr("rel") ?? "").toLowerCase();
    const as = ($(el).attr("as") ?? "").toLowerCase();
    if (!/\bstylesheet\b/.test(rel) && !(/\bpreload\b/.test(rel) && as === "style")) return;
    const media = ($(el).attr("media") ?? "").trim().toLowerCase() || null;
    if (media && /^print$/.test(media)) return;
    const url = absoluteUrl($(el).attr("href") ?? "", pageUrl);
    if (!url || out.some((l) => l.url === url)) return;
    out.push({ url, sameOrigin: isOwnOrigin(url, pageUrl), media });
  });
  return out;
}

/** Stylesheets that only declare fonts (Elementor/OMGF local Google Fonts, theme font files). */
export function isFontStylesheet(url: string): boolean {
  return /google-fonts|omgf|webfont|font-?face|\/fonts?\/|[/._-]fonts?\.css|typekit|typography/i.test(url);
}

/**
 * Phase 1 of the fetch: the same-origin theme sheets, at most `limit` (Elementor kit and
 * global styles before the theme, plugins last). Font sheets come in phase 2.
 */
export function stylesheetsToFetch(links: StylesheetLink[], limit = MAX_STYLESHEETS): string[] {
  const own = links.filter((l) => l.sameOrigin && !isFontStylesheet(l.url));
  const rank = (url: string) =>
    /elementor\/css\/post-\d+|global-styles|\/et-cache\/|customizer/i.test(url)
      ? 0
      : /\/themes\/|(^|[/._-])(style|theme|main|app|bootstrap|site)([._-]|$)/i.test(url)
        ? 1
        : /\/plugins\//i.test(url)
          ? 3
          : 2;
  return [...own].sort((a, b) => rank(a.url) - rank(b.url)).slice(0, limit).map((l) => l.url);
}

/** Phase 2: font sheets, those naming a detected family first („…/google-fonts/css/poppins.css“). */
export function fontStylesheetsToFetch(links: StylesheetLink[], families: string[], limit: number): string[] {
  const flat = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const slugs = families.map(flat).filter((f) => f.length >= 3);
  /** 2 = the file is named after a family („poppins.css“), 1 = the URL contains it („robotoslab“ for Roboto). */
  const score = (url: string) => {
    const file = flat((new URL(url).pathname.split("/").pop() ?? "").replace(/\.(min\.)?css$/i, ""));
    if (slugs.includes(file)) return 2;
    return slugs.some((slug) => flat(url).includes(slug)) ? 1 : 0;
  };
  return links
    .filter((l) => l.sameOrigin && isFontStylesheet(l.url))
    .sort((a, b) => score(b.url) - score(a.url))
    .slice(0, Math.max(0, limit))
    .map((l) => l.url);
}

export type DesignExtractionReport = {
  stylesheets: Array<{ url: string; status: "read" | "external" | "not_read" }>;
  inlineStyles: number;
  themes: string[];
  accentCandidates: Array<{ color: string; score: number; from: string }>;
  fontFamilies: { body: string[]; heading: string[] };
};

export type DesignExtraction = { design: DetectedDesign; report: DesignExtractionReport };

type Target = "body" | "html" | "h1" | "h2" | "h3" | "a" | "button";
type Classified = { target: Target; tier: number };

const STATE_PSEUDO = /:(hover|focus|focus-visible|focus-within|active|visited|disabled|checked|target|placeholder-shown|first-letter|first-line)\b|::|:(before|after)\b/;
const DARK_SCOPE = /(\.dark\b|dark-mode|is-dark|\[data-(bs-)?theme=["']?dark|\.theme-dark|prefers-color-scheme)/;
const EXCLUDED_SCOPE = /(header|footer|nav|menu|widget|sidebar|cookie|consent|cmplz|borlabs|cky|gdpr|modal|popup|banner|hero|slider|overlay|cover|breadcrumb|toolbar|admin-bar|wpadminbar|offcanvas|dropdown|mobile)/;
const CONSENT_SCOPE = /(cookie|consent|cmplz|borlabs|cky-|gdpr|wpcc|cc-window|cc-btn|wpadminbar|admin-bar|uc-|usercentrics)/;
/** WordPress colour utility classes (.has-vivid-red-color …): a palette, not the brand. */
const UTILITY_CLASS = /^\.has-[\w-]+-(color|background-color|border-color)$/;
const ROOTISH = /^(html|body|:root|\*|\.elementor-kit-\d+|#page|\.site|#wrapper|\.wp-site-blocks|#app|#__next|body\.[\w.-]+|html\[[^\]]*\]|:root\[[^\]]*\])$/;
const CONTENTISH = /^(main|article|section|\.entry-content|\.post-content|\.page-content|\.entry|\.content|#content|\.site-content|\.site-main|#main|#primary|\.wp-block-post-content|\.elementor-widget-text-editor|\.elementor-text-editor|\.elementor-widget-container|\.et_pb_text|\.et_pb_text_inner|\.et_pb_section|\.prose|\.container|\.single-content|\.page|\.post|\.inside-article|\.ast-container|\.entry-wrap)$/;
const BUTTON_CLASS = /(^|[.\s])(button|btn|btn-primary|wp-element-button|wp-block-button__link|elementor-button|et_pb_button|ast-button|kb-button|cta|cta-button|submit)(?=$|[.\s:[])/;

/** :where(a, b) / :is(a, b) → one selector per alternative; :not(…) is dropped. */
function expandSelector(selector: string, depth = 0): string[] {
  const s = selector.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, "");
  const m = /:(where|is)\(/.exec(s);
  if (!m || depth > 3) return [s];
  const start = m.index + m[0].length;
  let level = 1;
  let end = start;
  for (; end < s.length && level > 0; end++) {
    if (s[end] === "(") level++;
    else if (s[end] === ")") level--;
  }
  const inner = s.slice(start, end - 1);
  const before = s.slice(0, m.index);
  const after = s.slice(end);
  return splitTopLevel(inner, ",")
    .slice(0, 12)
    .flatMap((alt) => expandSelector(`${before}${alt.trim()}${after}`, depth + 1));
}

function classifySimple(selector: string): Classified | null {
  const s = selector.trim().toLowerCase();
  if (!s || STATE_PSEUDO.test(s) || DARK_SCOPE.test(s)) return null;
  const compounds = s.replace(/\s*[>+~]\s*/g, " ").split(/\s+/).filter(Boolean);
  if (compounds.length === 0 || compounds.length > 4) return null;
  const last = compounds[compounds.length - 1]!;
  const prefix = compounds.slice(0, -1);
  const prefixOk = (allowContent: boolean) =>
    prefix.every((c) => ROOTISH.test(c) || (allowContent && CONTENTISH.test(c))) && !prefix.some((c) => EXCLUDED_SCOPE.test(c));
  const contentPrefix = prefix.some((c) => CONTENTISH.test(c));

  if (/^(html|:root)$/.test(last)) return prefixOk(false) ? { target: "html", tier: 2 } : null;
  if (/^(body|\.elementor-kit-\d+)$/.test(last)) return prefixOk(false) ? { target: "body", tier: 2 } : null;
  if (/^body[.[]/.test(last) && prefixOk(false)) return { target: "body", tier: 1 };

  if (BUTTON_CLASS.test(last) || /^button\b/.test(last) || /\[type=["']?submit/.test(last)) {
    return CONSENT_SCOPE.test(s) ? null : { target: "button", tier: 1 };
  }

  const el = /^(h1|h2|h3|a)(?=$|[.#[:])/.exec(last)?.[1] as Target | undefined;
  if (!el) return null;
  const extra = last.slice(el.length);
  if (EXCLUDED_SCOPE.test(extra)) return null;
  if (!prefixOk(true)) return null;
  const genericClass = !extra || /^(\.wp-block-heading|\.elementor-heading-title|\[[^\]]*\])$/.test(extra);
  if (!genericClass) return { target: el, tier: 1 };
  return { target: el, tier: contentPrefix ? 3 : 2 };
}

function classify(selector: string): Classified[] {
  return expandSelector(selector)
    .map(classifySimple)
    .filter((c): c is Classified => Boolean(c));
}

function mediaAllowed(media: string[]): boolean {
  return media.every((m) => !/print|speech|prefers-color-scheme\s*:\s*dark|max-width|prefers-reduced|forced-colors|prefers-contrast|orientation|hover\s*:\s*none/.test(m));
}

// --- variables ----------------------------------------------------------------------------------

class VarBook {
  private readonly vars = new Map<string, { value: string; order: number }>();

  add(name: string, value: string, order: number) {
    const prev = this.vars.get(name);
    if (!prev || prev.order <= order) this.vars.set(name, { value, order });
  }

  has(name: string): boolean {
    return this.vars.has(name);
  }

  names(): string[] {
    return [...this.vars.keys()];
  }

  raw(name: string): string | null {
    return this.vars.get(name)?.value ?? null;
  }

  /** Resolve var() references (with fallbacks), at most 8 levels deep. */
  resolve(value: string, depth = 0): string {
    if (depth > 8 || !value.includes("var(")) return value;
    let out = "";
    let i = 0;
    while (i < value.length) {
      const at = value.indexOf("var(", i);
      if (at < 0) {
        out += value.slice(i);
        break;
      }
      out += value.slice(i, at);
      let level = 1;
      let j = at + 4;
      for (; j < value.length && level > 0; j++) {
        if (value[j] === "(") level++;
        else if (value[j] === ")") level--;
      }
      const inner = value.slice(at + 4, j - 1);
      const [nameRaw, ...rest] = splitTopLevel(inner, ",");
      const name = (nameRaw ?? "").trim();
      const fallback = rest.join(",").trim();
      const found = this.vars.get(name)?.value;
      out += found !== undefined ? this.resolve(found, depth + 1) : fallback ? this.resolve(fallback, depth + 1) : "";
      i = j;
    }
    return out.trim();
  }

  get(name: string): string | null {
    const v = this.vars.get(name);
    return v ? this.resolve(v.value) : null;
  }
}

/** Theme variables per field, most specific first. */
const THEME_COLOR_VARS: Record<DesignColorKey, string[]> = {
  text: [
    "--wp--preset--color--contrast",
    "--wp--preset--color--foreground",
    "--wp--preset--color--text",
    "--e-global-color-text",
    "--gcid-body-color",
    "--bs-body-color",
    "--ast-global-color-3",
    "--global-palette4",
    "--theme-text-color",
    "--contrast",
    "--foreground",
    "--color-foreground",
    "--color-text",
    "--text-color",
    "--body-color",
    "--color-body",
  ],
  background: [
    "--wp--preset--color--base",
    "--wp--preset--color--background",
    "--gcid-background-color",
    "--bs-body-bg",
    "--ast-global-color-5",
    "--global-palette9",
    "--base-3",
    "--background",
    "--color-background",
    "--bg-color",
    "--body-bg",
  ],
  heading: [
    "--wp--preset--color--heading",
    "--e-global-color-primary",
    "--gcid-heading-color",
    "--bs-heading-color",
    "--ast-global-color-2",
    "--global-palette3",
    "--theme-headings-color",
    "--heading-color",
    "--headings-color",
    "--color-heading",
  ],
  link: ["--wp--style--color--link", "--bs-link-color", "--theme-link-initial-color", "--link-color", "--color-link"],
  accent: [
    "--wp--preset--color--primary",
    "--wp--preset--color--accent",
    "--wp--preset--color--secondary",
    "--e-global-color-accent",
    "--e-global-color-primary",
    "--gcid-primary-color",
    "--bs-primary",
    "--ast-global-color-0",
    "--global-palette1",
    "--theme-palette-color-1",
    "--accent",
    "--color-accent",
    "--primary",
    "--color-primary",
    "--brand",
    "--color-brand",
    "--primary-color",
    "--accent-color",
  ],
  muted: [
    "--bs-secondary-color",
    "--muted-foreground",
    "--color-muted-foreground",
    "--color-muted",
    "--text-muted",
    "--global-palette6",
    "--contrast-3",
    "--meta-color",
  ],
};

const THEME_FONT_VARS = {
  body: [
    "--wp--preset--font-family--body",
    "--wp--preset--font-family--base",
    "--wp--preset--font-family--primary",
    "--e-global-typography-text-font-family",
    "--bs-body-font-family",
    "--global-body-font-family",
    "--font-body",
    "--body-font-family",
    "--font-family-base",
    "--default-font-family",
    "--font-sans",
  ],
  heading: [
    "--wp--preset--font-family--heading",
    "--wp--preset--font-family--headings",
    "--e-global-typography-primary-font-family",
    "--global-heading-font-family",
    "--font-heading",
    "--heading-font-family",
    "--headings-font-family",
    "--font-display",
  ],
};

/** Variable names of WordPress' default palette: not the brand. */
const WP_DEFAULT_PALETTE = /^--wp--preset--color--(black|white|cyan-bluish-gray|pale-pink|vivid-red|luminous-vivid-orange|luminous-vivid-amber|light-green-cyan|vivid-green-cyan|pale-cyan-blue|vivid-cyan-blue|vivid-purple)$/;

/** A resolved value as an opaque hex colour; alpha is painted over `over`. Gradients and images: null. */
function colorOf(value: string | null | undefined, over = "#ffffff", bareHsl = false): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v || /gradient\(/i.test(v)) return null;
  let c = parseColor(v, { bareHsl });
  if (!c) {
    // Shorthand (background: #fff url(…) no-repeat): its colour token.
    const tokens = splitTopLevel(v.replace(/url\((?:[^()]|\([^()]*\))*\)/gi, " "), " ")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length > 1) c = tokens.map((t) => parseColor(t)).find(Boolean) ?? null;
  }
  if (!c || c.a < 0.35) return null;
  return toHex(c.a < 1 ? blendOver(c, parseColor(over) ?? { r: 255, g: 255, b: 255, a: 1 }) : c);
}

function weightOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "bold") return 700;
  if (v === "normal") return 400;
  return sanitizeHeadingWeight(v);
}

// --- fonts --------------------------------------------------------------------------------------

type FaceInfo = GroundingFontFace & { own: boolean; latin: boolean };

function normalizeFaceWeight(value: string | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  if (!v || v === "normal") return "400";
  if (v === "bold") return "700";
  const nums = v.split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n >= 1 && n <= 1000);
  if (nums.length === 2) return `${Math.round(nums[0]! / 100) * 100 || 100} ${Math.round(nums[1]! / 100) * 100 || 900}`;
  if (nums.length === 1) return String(Math.min(900, Math.max(100, Math.round(nums[0]! / 100) * 100)));
  return "400";
}

function collectFontFaces(fontFaces: CssFontFaceRule[], pageUrl: string): Map<string, FaceInfo[]> {
  const byFamily = new Map<string, FaceInfo[]>();
  for (const rule of fontFaces) {
    const get = (p: string) => rule.declarations.filter((d) => d.property === p).at(-1)?.value;
    const family = parseFontFamilyList(get("font-family"))[0];
    const src = get("src");
    if (!family || !src) continue;
    const base = rule.sourceUrl ?? pageUrl;
    // An https page cannot load http fonts; on the own domain the https URL is the same file.
    const upgrade = (abs: string | null) => (abs && /^https:/i.test(pageUrl) && /^http:/i.test(abs) && isOwnOrigin(abs, pageUrl) ? abs.replace(/^http:/i, "https:") : abs);
    const entries = parseFontSrc(src)
      .map((e) => ({ ...e, abs: upgrade(absoluteUrl(e.url, base)) }))
      .filter((e): e is { url: string; format: string | null; abs: string } => Boolean(e.abs));
    const pick =
      entries.find((e) => e.format === "woff2" || /\.woff2(\?|$)/i.test(e.abs)) ??
      entries.find((e) => e.format === "woff" || /\.woff(\?|$)/i.test(e.abs)) ??
      entries[0];
    if (!pick) continue;
    const isWoff2 = pick.format === "woff2" || /\.woff2(\?|$)/i.test(pick.abs);
    const isWoff = !isWoff2 && (pick.format === "woff" || /\.woff(\?|$)/i.test(pick.abs));
    const range = (get("unicode-range") ?? "").toLowerCase();
    const face: FaceInfo = {
      url: pick.abs.replace(/[?#].*$/, ""),
      format: isWoff2 ? "woff2" : "woff",
      weight: normalizeFaceWeight(get("font-weight")),
      style: /italic|oblique/i.test(get("font-style") ?? "") ? "italic" : "normal",
      own: isOwnOrigin(pick.abs, pageUrl) && (isWoff2 || isWoff),
      latin: !range || /u\+0000-00ff|u\+0-ff|u\+0020-007f|u\+0000-007f/i.test(range),
    };
    const key = family.toLowerCase();
    byFamily.set(key, [...(byFamily.get(key) ?? []), face]);
  }
  return byFamily;
}

function weightMatches(face: GroundingFontFace, weight: number): boolean {
  const [a, b] = face.weight.split(" ").map(Number);
  return b ? weight >= a! && weight <= b : a === weight;
}

function chooseFaces(faces: FaceInfo[], weights: number[]): GroundingFontFace[] {
  const own = faces.filter((f) => f.own);
  const pool = own.some((f) => f.latin) ? own.filter((f) => f.latin) : own;
  const out: GroundingFontFace[] = [];
  for (const w of weights) {
    const face = pool.find((f) => f.style === "normal" && weightMatches(f, w));
    if (face && !out.some((o) => o.url === face.url)) out.push({ url: face.url, format: face.format, weight: face.weight, style: face.style });
  }
  if (out.length === 0 && pool[0]) out.push({ url: pool[0].url, format: pool[0].format, weight: pool[0].weight, style: pool[0].style });
  return out.slice(0, 3);
}

type FontEvidence = { faces: Map<string, FaceInfo[]>; externalFamilies: Set<string>; externalHosts: Set<string> };

function fontFor(
  declared: string[],
  role: "body" | "heading",
  weights: number[],
  evidence: FontEvidence,
  notes: string[],
): GroundingFont | null {
  const families = declared.filter((f) => !isIconFont(f));
  const primary = families[0];
  if (!primary) return null;
  if (isSystemFamily(primary)) {
    const stack = systemOnlyStack(families);
    return stack ? { name: isGenericFamily(primary) ? "Systemschrift" : primary, css_stack: stack, source: "system" } : null;
  }
  const key = systemStackKeyFor(primary, families);
  const fallback = SYSTEM_STACKS[key].stack;
  const label = role === "body" ? "Textschrift" : "Überschriftenschrift";
  const faces = evidence.faces.get(primary.toLowerCase()) ?? [];
  const chosen = chooseFaces(faces, weights);
  if (chosen.length > 0) {
    return {
      name: primary,
      css_stack: buildFontStack([primary, ...parseFontFamilyList(fallback)]),
      source: "self-hosted",
      font_face_urls: chosen,
    };
  }
  const externalFace = faces.find((f) => !f.own);
  const external =
    faces.some((f) => !f.own) || evidence.externalFamilies.has(primary.toLowerCase()) || (evidence.externalHosts.size > 0 && faces.length === 0);
  if (external) {
    const host = (() => {
      try {
        return externalFace ? new URL(externalFace.url).hostname : [...evidence.externalHosts][0] ?? null;
      } catch {
        return null;
      }
    })();
    notes.push(
      `${label} „${primary}“ wird von einem externen Dienst geladen${host ? ` (${host})` : ""}. Aus Datenschutzgründen lädt die Grounding Page sie nicht und nutzt eine ähnliche Systemschrift.`,
    );
    return { name: primary, css_stack: fallback, source: "external" };
  }
  notes.push(`${label} „${primary}“ wurde nicht als Datei auf der eigenen Domain gefunden (woff2/woff) – die Grounding Page nutzt eine ähnliche Systemschrift.`);
  return { name: primary, css_stack: fallback, source: "system" };
}

// --- main ---------------------------------------------------------------------------------------

type Decl = { value: string; score: number };

function pick(list: Decl[] | undefined): string | null {
  if (!list || list.length === 0) return null;
  return list.reduce((best, d) => (d.score > best.score ? d : best)).value;
}

/** Base font size in px from body/html font-size (rem/em/% against the root size). */
function baseFontSizePx(bodySize: string | null, rootSize: string | null): number | null {
  const toPx = (value: string | null, root: number): number | null => {
    if (!value) return null;
    const m = /^([\d.]+)(px|rem|em|%)?$/i.exec(value.trim());
    if (!m) return null;
    const n = Number(m[1]);
    const unit = (m[2] ?? "px").toLowerCase();
    if (!Number.isFinite(n)) return null;
    return unit === "px" ? n : unit === "%" ? (n / 100) * root : n * root;
  };
  const root = toPx(rootSize, 16) ?? 16;
  const body = toPx(bodySize, root);
  return sanitizeBaseFontSize(body ?? (rootSize ? root : null));
}

/**
 * Detect the design. `stylesheets` maps fetched same-origin stylesheet URLs to their CSS;
 * linked sheets that are not in it count as not read (external ones as font evidence).
 */
export function extractDesign(input: { pageUrl: string; html: string; stylesheets: Record<string, string> }): DesignExtraction {
  const $ = cheerio.load(input.html);
  const report: DesignExtractionReport = { stylesheets: [], inlineStyles: 0, themes: [], accentCandidates: [], fontFamilies: { body: [], heading: [] } };
  const rules: CssStyleRule[] = [];
  const fontFaces: CssFontFaceRule[] = [];
  const externalHosts = new Set<string>();
  const externalFamilies = new Set<string>();
  let order = 0;

  const noteExternal = (url: string) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (EXTERNAL_FONT_HOSTS.test(host)) externalHosts.add(host);
      for (const f of familiesFromFontServiceUrl(url)) externalFamilies.add(f.toLowerCase());
    } catch {
      /* ignore */
    }
  };
  const addCss = (css: string, sourceUrl: string | null) => {
    const parsed = parseCss(css, { sourceUrl, startOrder: order });
    order = parsed.nextOrder;
    rules.push(...parsed.rules);
    fontFaces.push(...parsed.fontFaces);
    for (const imp of parsed.imports) {
      const abs = absoluteUrl(imp, sourceUrl ?? input.pageUrl);
      if (abs && !isOwnOrigin(abs, input.pageUrl)) noteExternal(abs);
    }
  };

  $("link[href], style").each((_, el) => {
    if (el.tagName === "style") {
      report.inlineStyles += 1;
      addCss($(el).text(), null);
      return;
    }
    const rel = ($(el).attr("rel") ?? "").toLowerCase();
    if (!/\bstylesheet\b/.test(rel) && !/\bpreload\b/.test(rel)) return;
    const url = absoluteUrl($(el).attr("href") ?? "", input.pageUrl);
    if (!url) return;
    if (!isOwnOrigin(url, input.pageUrl)) {
      noteExternal(url);
      if (/\bstylesheet\b/.test(rel) && !report.stylesheets.some((s) => s.url === url)) report.stylesheets.push({ url, status: "external" });
      return;
    }
    if (!/\bstylesheet\b/.test(rel) || report.stylesheets.some((s) => s.url === url)) return;
    const css = input.stylesheets[url];
    if (typeof css === "string") {
      report.stylesheets.push({ url, status: "read" });
      addCss(css, url);
    } else {
      report.stylesheets.push({ url, status: "not_read" });
    }
  });

  // Variables on root-ish selectors (last one wins), dark variants left out.
  const vars = new VarBook();
  for (const rule of rules) {
    if (!mediaAllowed(rule.media)) continue;
    const rootish = rule.selectors.some((s) => !DARK_SCOPE.test(s.toLowerCase()) && /^(:root|html|body|\.elementor-kit-\d+|:root\s*,?\s*:host|\[data-bs-theme=["']?light["']?\]|:host)$/i.test(s.trim()));
    if (!rootish) continue;
    for (const d of rule.declarations) if (d.property.startsWith("--")) vars.add(d.property, d.value, rule.order + (d.important ? 1e6 : 0));
  }

  const names = vars.names().join(" ");
  if (/--wp--preset--/.test(names)) report.themes.push("WordPress (theme.json)");
  if (/--e-global-/.test(names) || rules.some((r) => r.selectors.some((s) => /\.elementor-kit-\d+/.test(s)))) report.themes.push("Elementor");
  if (/--gcid-/.test(names) || rules.some((r) => r.selectors.some((s) => /\.et_pb_|#et-|\.et-db/.test(s)))) report.themes.push("Divi");
  if (/--bs-/.test(names)) report.themes.push("Bootstrap");
  if (/--tw-|--color-[a-z]+-\d{2,3}\b|--font-sans\b/.test(names)) report.themes.push("Tailwind");
  if (/--ast-global-color/.test(names)) report.themes.push("Astra");
  if (/--global-palette/.test(names)) report.themes.push("Kadence");

  // Element rules → declarations per target and property.
  const byTarget = new Map<string, Decl[]>();
  const buttonColors = new Map<string, { score: number; order: number }>();
  const allColors = new Map<string, number>();
  for (const rule of rules) {
    if (!mediaAllowed(rule.media)) continue;
    const classes = rule.selectors.flatMap(classify);
    const utility = rule.selectors.every((sel) => UTILITY_CLASS.test(sel.trim()));
    for (const d of rule.declarations) {
      if (d.property.startsWith("--")) continue;
      if (!utility && /^(color|background-color|background|border-color|border-left-color|border-bottom-color|fill)$/.test(d.property)) {
        const c = colorOf(vars.resolve(d.value));
        if (c && !isNeutralColor(c)) allColors.set(c, (allColors.get(c) ?? 0) + 1);
      }
      for (const cls of classes) {
        const score = cls.tier * 1e8 + (d.important ? 5e7 : 0) + rule.order;
        if (cls.target === "button") {
          if (d.property !== "background-color" && d.property !== "background") continue;
          const c = colorOf(vars.resolve(d.value));
          if (!c || isNeutralColor(c)) continue;
          const prev = buttonColors.get(c);
          buttonColors.set(c, { score: (prev?.score ?? 0) + 1, order: Math.max(prev?.order ?? 0, rule.order) });
          continue;
        }
        const key = `${cls.target}|${d.property}`;
        byTarget.set(key, [...(byTarget.get(key) ?? []), { value: vars.resolve(d.value), score }]);
      }
    }
  }

  const rootProp = (p: string) => pick(byTarget.get(`body|${p}`)) ?? pick(byTarget.get(`html|${p}`));
  const headingProp = (p: string): string | null => {
    const values = (["h2", "h1", "h3"] as const).map((h) => pick(byTarget.get(`${h}|${p}`))).filter((v): v is string => Boolean(v));
    if (values.length === 0) return null;
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return values.reduce((best, v) => ((counts.get(v) ?? 0) > (counts.get(best) ?? 0) ? v : best), values[0]!);
  };
  const themeColor = (key: DesignColorKey, over: string): string | null => {
    for (const name of THEME_COLOR_VARS[key]) {
      const c = colorOf(vars.get(name), over, true);
      if (c) return c;
    }
    return null;
  };

  const notes: string[] = [];
  const colors: Partial<Record<DesignColorKey, string>> = {};

  const bg = colorOf(rootProp("background-color")) ?? colorOf(rootProp("background")) ?? themeColor("background", "#ffffff");
  if (bg) colors.background = bg;
  const over = bg ?? NEUTRAL_DESIGN.colors.background;
  const text = colorOf(rootProp("color"), over) ?? themeColor("text", over);
  if (text) colors.text = text;
  const heading = colorOf(headingProp("color"), over) ?? themeColor("heading", over);
  if (heading) colors.heading = heading;
  const link = colorOf(pick(byTarget.get("a|color")), over) ?? themeColor("link", over);
  if (link) colors.link = link;

  // Accent: the most used button colour, a theme accent variable, the link, the commonest brand colour.
  const themeAccents = THEME_COLOR_VARS.accent
    .map((name) => ({ name, color: colorOf(vars.get(name), over, true) }))
    .filter((x): x is { name: string; color: string } => Boolean(x.color) && !isNeutralColor(x.color!));
  for (const name of vars.names()) {
    if (!/^--wp--preset--color--/.test(name) || WP_DEFAULT_PALETTE.test(name) || THEME_COLOR_VARS.accent.includes(name)) continue;
    const c = colorOf(vars.get(name), over);
    if (c && !isNeutralColor(c) && !themeAccents.some((t) => t.color === c)) themeAccents.push({ name, color: c });
  }
  // Ties between button colours: a theme variable named „accent“ beats „primary“; the text colour is no accent.
  const themeBonus = (color: string) => {
    const hit = themeAccents.find((t) => t.color === color);
    return hit ? (/accent/.test(hit.name) ? 0.5 : 0.3) : 0;
  };
  const buttons = [...buttonColors.entries()]
    .map(([color, v]) => ({
      color,
      score: v.score + themeBonus(color) + (color === link ? 0.25 : 0) - (color === text || color === heading ? 0.4 : 0),
      order: v.order,
    }))
    .sort((a, b) => b.score - a.score || b.order - a.order);
  report.accentCandidates = [
    ...buttons.map((b) => ({ color: b.color, score: b.score, from: "Buttons" })),
    ...themeAccents.map((t) => ({ color: t.color, score: 0, from: t.name })),
  ].slice(0, 8);
  const frequent = [...allColors.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const accent = buttons[0]?.color ?? themeAccents[0]?.color ?? (link && !isNeutralColor(link) ? link : null) ?? frequent;
  if (accent) colors.accent = accent;
  const muted = themeColor("muted", over);
  if (muted) colors.muted = muted;

  // Contrast (WCAG AA). Text on background decides first; the rest is measured on the result.
  if (colors.text || colors.background) {
    const t = colors.text ?? NEUTRAL_DESIGN.colors.text;
    const b = colors.background ?? NEUTRAL_DESIGN.colors.background;
    const ratio = contrastRatio(t, b);
    if (ratio < 4.5) {
      delete colors.text;
      delete colors.background;
      notes.push(`Text auf Hintergrund der Website hat nur einen Kontrast von ${roundRatio(ratio)}:1 (WCAG AA verlangt 4,5:1). Die Grounding Page nutzt dafür die neutralen Farben.`);
    }
  }
  const finalBg = colors.background ?? NEUTRAL_DESIGN.colors.background;
  const finalText = colors.text ?? NEUTRAL_DESIGN.colors.text;
  if (colors.heading) {
    const ratio = contrastRatio(colors.heading, finalBg);
    if (ratio < 3) {
      delete colors.heading;
      notes.push(`Überschriftenfarbe hat nur einen Kontrast von ${roundRatio(ratio)}:1 – Überschriften nutzen die Textfarbe.`);
    }
  }
  const adjust = (key: DesignColorKey, min: number, label: string) => {
    const value = colors[key];
    if (!value) return;
    const fixed = ensureContrast(value, finalBg, min);
    if (!fixed.adjusted) return;
    colors[key] = fixed.color;
    notes.push(`${label} für die Lesbarkeit angepasst (Kontrast ${roundRatio(fixed.before)}:1 → ${roundRatio(fixed.after)}:1).`);
  };
  adjust("link", 4.5, "Linkfarbe");
  adjust("muted", 4.5, "Gedämpfte Farbe");
  if (!colors.link && colors.accent) {
    // No own link colour: links take the accent, readable as body text (AA 4.5:1).
    colors.link = ensureContrast(colors.accent, finalBg, 4.5).color;
    if (colors.link !== colors.accent) notes.push("Die Website setzt keine eigene Linkfarbe; Links nutzen die Akzentfarbe, für Fließtext abgedunkelt.");
  }
  if (!colors.muted && (colors.text || colors.background)) colors.muted = deriveMutedColor(finalText, finalBg);

  // Fonts.
  const evidence: FontEvidence = { faces: collectFontFaces(fontFaces, input.pageUrl), externalFamilies, externalHosts };
  const firstVarFamilies = (list: string[]) => {
    for (const name of list) {
      const v = vars.get(name);
      const families = parseFontFamilyList(v);
      if (families.length > 0) return families;
    }
    return [];
  };
  // A brand font in the theme system (Elementor globals …) beats a theme's system-font body rule:
  // content widgets use the global font, the body rule is only the theme's default.
  const pickFamilies = (rule: string[], themeVars: string[]) => {
    const fromVars = firstVarFamilies(themeVars);
    if (rule.length === 0 || rule.every(isIconFont)) return fromVars;
    if (isSystemFamily(rule[0]!) && fromVars[0] && !isSystemFamily(fromVars[0])) return fromVars;
    return rule;
  };
  const bodyFamilies = pickFamilies(parseFontFamilyList(rootProp("font-family")), THEME_FONT_VARS.body);
  const headingFamilies = pickFamilies(parseFontFamilyList(headingProp("font-family")), THEME_FONT_VARS.heading);
  report.fontFamilies = { body: bodyFamilies, heading: headingFamilies };

  const headingWeight = weightOf(headingProp("font-weight")) ?? weightOf(vars.get("--e-global-typography-primary-font-weight"));
  const fonts: DetectedDesign["fonts"] = {};
  const bodyFont = fontFor(bodyFamilies, "body", [400, 700], evidence, notes);
  if (bodyFont) fonts.body = bodyFont;
  const sameAsBody = headingFamilies.length > 0 && bodyFamilies.length > 0 && headingFamilies[0]!.toLowerCase() === bodyFamilies[0]!.toLowerCase();
  if (headingFamilies.length > 0 && !sameAsBody) {
    const headingFont = fontFor(headingFamilies, "heading", [headingWeight ?? 700], evidence, notes);
    if (headingFont) fonts.heading = headingFont;
  } else if (sameAsBody && bodyFont?.source === "self-hosted") {
    // Same family: make sure the heading weight is among the files.
    const faces = chooseFaces(evidence.faces.get(bodyFamilies[0]!.toLowerCase()) ?? [], [400, headingWeight ?? 700, 700]);
    fonts.body = { ...bodyFont, font_face_urls: faces };
  }

  const typography: DetectedDesign["typography"] = {};
  if (headingWeight !== null) typography.headingWeight = headingWeight;
  const spacing = sanitizeLetterSpacing(headingProp("letter-spacing"));
  if (spacing && spacing !== "normal" && !/^-?0(\.0+)?(em|rem|px)$/.test(spacing)) typography.headingLetterSpacing = spacing;
  if ((headingProp("text-transform") ?? "").trim().toLowerCase() === "uppercase") typography.headingUppercase = true;
  const size = baseFontSizePx(pick(byTarget.get("body|font-size")) ?? vars.get("--bs-body-font-size"), pick(byTarget.get("html|font-size")));
  if (size !== null) typography.baseFontSize = size;

  const design = sanitizeDetectedDesign({ colors, fonts, typography, notes }) ?? { colors: {}, fonts: {}, typography: {}, notes: [] };
  if (Object.keys(design.colors).length === 0 && Object.keys(design.fonts).length === 0) {
    design.notes.push("Auf der Website wurden keine Farben oder Schriften gefunden – es gilt das neutrale Design.");
  }
  // Keep normalised hex values only (sanitize already did), and the font notes once.
  design.notes = [...new Set(design.notes)];
  for (const key of Object.keys(design.colors) as DesignColorKey[]) design.colors[key] = normalizeHex(design.colors[key]) ?? design.colors[key]!;
  return { design, report };
}
