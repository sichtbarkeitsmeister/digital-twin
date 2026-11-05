/**
 * The inline CSS of a Grounding Page, built from the design profile through CSS variables on
 * :root. Same layout as the neutral template (max-width, data grid, breadcrumb, sources);
 * only colours, fonts and heading style change. Limits (Grounding Page Standard v1.7: light,
 * static HTML, a little inline CSS): at most GROUNDING_CSS_BUDGET bytes, no @import, no
 * external resources except self-hosted font files on the client's own origin.
 * Pure and browser-safe (the design card builds its live preview with it).
 */

import type { GroundingFont, GroundingFontFace, ResolvedDesign } from "@/lib/dt/seo/grounding-design/profile";
import { NEUTRAL_DESIGN } from "@/lib/dt/seo/grounding-design/profile";
import { quoteFamily } from "@/lib/dt/seo/grounding-design/fonts";
import { isOwnOrigin } from "@/lib/dt/seo/grounding-design/origin";

/** Byte budget of all inline CSS of a page (about 2 KB). */
export const GROUNDING_CSS_BUDGET = 2048;

/** Marks the design block, so a later design change can swap it without touching content. */
export const DESIGN_STYLE_ID = "gp-design";

/** Wrapper of the CMS snippet; the scoped CSS hangs off it. */
export const SNIPPET_WRAPPER_CLASS = "grounding-page";

/** The neutral template, byte for byte as before design profiles existed. */
export const NEUTRAL_CSS = `body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6;color:#1b1f24;background:#fff}
main{max-width:46rem;margin:0 auto;padding:2rem 1rem 3rem}
.breadcrumb{display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;margin:0 0 1.5rem;padding:0;font-size:.875rem}
.breadcrumb li+li::before{content:"›";margin-right:.5rem;color:#6b7280}
.lead-definition{font-size:1.125rem}
.data-grid{display:grid;grid-template-columns:minmax(8rem,max-content) 1fr;gap:.35rem 1.25rem;margin:1rem 0}
.data-grid dt{font-weight:600}.data-grid dd{margin:0;grid-column:2}
.source,.page-meta{font-size:.875rem;color:#4b5563}
section{margin-top:2rem}`;

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function shortHex(hex: string): string {
  const m = hex.match(/^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/i);
  return m ? `#${m[1]}${m[2]}${m[3]}` : hex;
}

type Rule = [selector: string, body: string];

function rootVars(design: ResolvedDesign): string {
  const c = design.colors;
  const sameFont = design.fonts.heading.css_stack === design.fonts.body.css_stack;
  return [
    `--gp-text:${shortHex(c.text)}`,
    `--gp-bg:${shortHex(c.background)}`,
    `--gp-heading:${shortHex(c.heading)}`,
    `--gp-link:${shortHex(c.link)}`,
    `--gp-accent:${shortHex(c.accent)}`,
    `--gp-muted:${shortHex(c.muted)}`,
    `--gp-font:${design.fonts.body.css_stack}`,
    `--gp-heading-font:${sameFont ? "var(--gp-font)" : design.fonts.heading.css_stack}`,
    `--gp-heading-weight:${design.headingWeight}`,
    `--gp-heading-spacing:${design.headingLetterSpacing}`,
    `--gp-heading-case:${design.headingUppercase ? "uppercase" : "none"}`,
    `--gp-size:${design.baseFontSize ? `${design.baseFontSize}px` : "100%"}`,
  ].join(";");
}

/** Rules of the design template; `:root`, `body` and `main` are mapped for the snippet. */
function designRules(design: ResolvedDesign): Rule[] {
  return [
    [":root", rootVars(design)],
    ["body", "margin:0;font-family:var(--gp-font);font-size:var(--gp-size);line-height:1.6;color:var(--gp-text);background:var(--gp-bg)"],
    [
      "h1,h2,h3",
      "font-family:var(--gp-heading-font);color:var(--gp-heading);font-weight:var(--gp-heading-weight);letter-spacing:var(--gp-heading-spacing);text-transform:var(--gp-heading-case);line-height:1.25",
    ],
    ["a", "color:var(--gp-link)"],
    ["main", "max-width:46rem;margin:0 auto;padding:2rem 1rem 3rem"],
    [".breadcrumb", "display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;margin:0 0 1.5rem;padding:0;font-size:.875rem"],
    [".breadcrumb li+li::before", 'content:"›";margin-right:.5rem;color:var(--gp-muted)'],
    [".lead-definition", "font-size:1.125rem"],
    [
      ".data-grid",
      "display:grid;grid-template-columns:minmax(8rem,max-content) 1fr;gap:.35rem 1.25rem;margin:1rem 0;padding-left:1rem;border-left:3px solid var(--gp-accent)",
    ],
    [".data-grid dt", "font-weight:600"],
    [".data-grid dd", "margin:0;grid-column:2"],
    [".source,.page-meta", "font-size:.875rem;color:var(--gp-muted)"],
    [".review-notice", "padding-left:.75rem;border-left:3px solid var(--gp-accent)"],
    ["section", "margin-top:2rem"],
  ];
}

function scopeSelector(selector: string, scope: string): string {
  if (selector === ":root" || selector === "body" || selector === "main") return scope;
  return selector
    .split(",")
    .map((s) => `${scope} ${s.trim()}`)
    .join(",");
}

function scopeBody(selector: string, body: string): string {
  // In a CMS the theme's content column sets the width and padding.
  if (selector === "main") return "max-width:46rem;margin:0 auto";
  if (selector === "body") return body.replace(/^margin:0;/, "");
  return body;
}

function fontFaceRule(family: string, face: GroundingFontFace): string {
  return `@font-face{font-family:${quoteFamily(family)};src:url("${face.url}") format("${face.format}");font-weight:${face.weight};font-style:${face.style};font-display:swap}`;
}

/** Self-hosted faces in priority order: body regular, heading, body bold, the rest. */
function fontFaces(design: ResolvedDesign): Array<{ family: string; face: GroundingFontFace }> {
  const out: Array<{ family: string; face: GroundingFontFace }> = [];
  const seen = new Set<string>();
  const push = (family: string, face: GroundingFontFace | undefined) => {
    if (!face || seen.has(face.url)) return;
    seen.add(face.url);
    out.push({ family, face });
  };
  const facesOf = (role: "body" | "heading") => {
    const font = design.fonts[role];
    return font.source === "self-hosted" ? (font.font_face_urls ?? []) : [];
  };
  const body = facesOf("body");
  const heading = facesOf("heading");
  const isBold = (f: GroundingFontFace) => /^(6|7|8)00$/.test(f.weight);
  push(design.fonts.body.name, body.find((f) => !isBold(f) && f.style === "normal") ?? body[0]);
  push(design.fonts.heading.name, heading.find((f) => f.weight.split(" ")[0] === String(design.headingWeight)) ?? heading[0]);
  push(design.fonts.body.name, body.find((f) => isBold(f) && f.style === "normal"));
  for (const f of body) push(design.fonts.body.name, f);
  for (const f of heading) push(design.fonts.heading.name, f);
  return out;
}

export type DesignCss = {
  css: string;
  bytes: number;
  /** Font files left out to stay within the budget. */
  droppedFaces: number;
};

/**
 * The design CSS. `scope` (CMS snippet) prefixes every rule with the wrapper class and puts
 * the variables on the wrapper instead of :root. Font faces are added only while the whole
 * block stays within the budget; a dropped face falls back to the system stack behind it.
 */
export function buildDesignCss(design: ResolvedDesign, opts: { scope?: string } = {}): DesignCss {
  const rules = designRules(design).map(([selector, body]) =>
    opts.scope ? `${scopeSelector(selector, opts.scope)}{${scopeBody(selector, body)}}` : `${selector}{${body}}`,
  );
  const base = rules.join("\n");
  const faces = fontFaces(design);
  const accepted: string[] = [];
  let bytes = byteLength(base);
  for (const { family, face } of faces) {
    const rule = fontFaceRule(family, face);
    const size = byteLength(rule) + 1;
    if (bytes + size > GROUNDING_CSS_BUDGET) continue;
    accepted.push(rule);
    bytes += size;
  }
  const css = [...accepted, base].join("\n");
  return { css, bytes: byteLength(css), droppedFaces: faces.length - accepted.length };
}

/**
 * Font files only load on the page's own origin: a page on another host than the website
 * (e.g. a subdomain) keeps the font name in its stack but loads no file.
 */
export function designForPage(design: ResolvedDesign, pageUrl: string | null | undefined): ResolvedDesign {
  if (!pageUrl) return design;
  const fix = (font: GroundingFont): GroundingFont =>
    font.source === "self-hosted" && (font.font_face_urls ?? []).some((f) => !isOwnOrigin(f.url, pageUrl))
      ? { name: font.name, css_stack: font.css_stack, source: "system" }
      : font;
  return { ...design, fonts: { body: fix(design.fonts.body), heading: fix(design.fonts.heading) } };
}

function canonicalOf(html: string): string | null {
  const tag = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => /\brel\s*=\s*["']?canonical["']?/i.test(t));
  return tag ? (/\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? null) : null;
}

/**
 * The <style> block of a full page: the neutral template unchanged when there is no design.
 * `pageUrl` (the canonical URL) keeps font files to the page's own origin.
 */
export function designStyleBlock(design: ResolvedDesign | null, pageUrl?: string | null): string {
  if (!design) return `<style>\n${NEUTRAL_CSS}\n</style>`;
  return `<style id="${DESIGN_STYLE_ID}">\n${buildDesignCss(designForPage(design, pageUrl)).css}\n</style>`;
}

/** CSS for the CMS snippet, scoped to .grounding-page (neutral values when there is no design). */
export function snippetCss(design: ResolvedDesign | null, pageUrl?: string | null): string {
  return buildDesignCss(designForPage(design ?? NEUTRAL_DESIGN, pageUrl), { scope: `.${SNIPPET_WRAPPER_CLASS}` }).css;
}

const DESIGN_BLOCK = new RegExp(`<style\\b[^>]*\\bid=["']${DESIGN_STYLE_ID}["'][^>]*>[\\s\\S]*?<\\/style\\s*>`, "i");
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;

/**
 * Swap the design block of a page our template built (marked block, or the untouched neutral
 * CSS) for the current design. Pages from a CMS or edited by hand stay as they are.
 */
export function replaceDesignStyle(html: string, design: ResolvedDesign | null): { html: string; replaced: boolean } {
  const block = designStyleBlock(design, canonicalOf(html));
  if (DESIGN_BLOCK.test(html)) return { html: html.replace(DESIGN_BLOCK, () => block), replaced: true };
  let replaced = false;
  const out = html.replace(STYLE_BLOCK, (whole, css: string) => {
    if (replaced || css.trim() !== NEUTRAL_CSS) return whole;
    replaced = true;
    return block;
  });
  return { html: out, replaced };
}

const JSON_LD_BLOCK = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>[\s\S]*?<\/script\s*>/gi;
const RESOURCE_LINK_RELS = /\b(stylesheet|preload|preconnect|dns-prefetch|prefetch|modulepreload|prerender|icon|manifest)\b/i;

/** Apply `fn` to the HTML outside JSON-LD blocks (their JSON must stay byte for byte). */
function outsideJsonLd(html: string, fn: (part: string) => string): string {
  const parts: string[] = [];
  let last = 0;
  for (const m of html.matchAll(JSON_LD_BLOCK)) {
    parts.push(fn(html.slice(last, m.index)), m[0]);
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(fn(html.slice(last)));
  return parts.join("");
}

function stripAttribute(part: string, attr: RegExp): string {
  let prev: string;
  let out = part;
  do {
    prev = out;
    out = out.replace(new RegExp(`(<[a-zA-Z][^<>]*?)\\s+${attr.source}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "g"), "$1");
  } while (out !== prev);
  return out;
}

/**
 * For HTML written by the Grounding agent (or anyone else): the model must not bring its own
 * styles. Removes every <style>, style attribute, stylesheet/preload link, script that is not
 * JSON-LD and inline event handler, then puts the design block into <head>. Idempotent.
 */
export function injectDesign(html: string, design: ResolvedDesign | null): string {
  let out = outsideJsonLd(html, (part) => {
    let p = part.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>[ \t]*\n?/gi, "");
    p = p.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>[ \t]*\n?/gi, "");
    p = p.replace(/<link\b[^>]*>[ \t]*\n?/gi, (tag) => (RESOURCE_LINK_RELS.test(tag.match(/\brel\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i)?.[1] ?? "") ? "" : tag));
    p = stripAttribute(p, /style/);
    p = stripAttribute(p, /on[a-z]+/);
    p = p.replace(/(\bhref\s*=\s*["'])\s*javascript:[^"']*/gi, "$1#");
    return p;
  });
  const block = designStyleBlock(design, canonicalOf(out));
  if (/<\/head\s*>/i.test(out)) out = out.replace(/<\/head\s*>/i, `${block}\n</head>`);
  else if (/<html\b[^>]*>/i.test(out)) out = out.replace(/<html\b[^>]*>/i, (tag) => `${tag}\n<head>\n${block}\n</head>`);
  else out = `${block}\n${out}`;
  return out.replace(/\n{3,}/g, "\n\n");
}
