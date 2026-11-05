/**
 * The two download formats of a Grounding Page:
 * - „Als HTML-Datei“: the full standalone page (unchanged file, design block swapped in);
 * - „Für CMS (Snippet)“: only the page content in <div class="grounding-page">, plus the
 *   JSON-LD. No <html>, <head> or <body>. Without CSS by default so the CMS theme styles it;
 *   „Design mitliefern“ adds the design CSS scoped to .grounding-page.
 * Title, meta description, canonical URL and slug go into the CMS fields (cmsFieldsFromHtml).
 * String-level on purpose: the page content and the JSON-LD stay byte for byte, including the
 * review notice that review-stamp.ts put there. Pure and browser-safe.
 */

import { SNIPPET_WRAPPER_CLASS } from "@/lib/dt/seo/grounding-design/css";

export type CmsFields = {
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  /** Last path segment of the canonical URL („grounding“). */
  slug: string | null;
  /** Full path of the canonical URL („/grounding/“), for nested pages. */
  path: string | null;
  /** The page's H1 (CMS page title in themes that print the title as H1). */
  h1: string | null;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_m, e: string) => ENTITIES[e] ?? _m)
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim();
}

export function cmsFieldsFromHtml(html: string | null | undefined): CmsFields {
  const empty: CmsFields = { title: null, metaDescription: null, canonicalUrl: null, slug: null, path: null, h1: null };
  if (!html) return empty;
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((tag) => /\bname\s*=\s*["']?description["']?/i.test(tag));
  const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((tag) => /\brel\s*=\s*["']?canonical["']?/i.test(tag));
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const canonicalUrl = canonical ? attr(canonical, "href") : null;
  let path: string | null = null;
  let slug: string | null = null;
  if (canonicalUrl) {
    try {
      path = new URL(canonicalUrl).pathname || "/";
      slug = decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? "") || null;
    } catch {
      /* not a URL */
    }
  }
  return {
    title: title ? textOf(title) || null : null,
    metaDescription: meta ? attr(meta, "content") || null : null,
    canonicalUrl: canonicalUrl || null,
    slug,
    path,
    h1: h1 ? textOf(h1) || null : null,
  };
}

const JSON_LD = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>[\s\S]*?<\/script\s*>/gi;

/** Inner HTML of <main> (else <body>), without scripts and styles. */
function pageContent(html: string): string {
  const mainOpen = /<main\b[^>]*>/i.exec(html);
  const mainClose = html.toLowerCase().lastIndexOf("</main>");
  let inner: string;
  if (mainOpen && mainClose > mainOpen.index) {
    inner = html.slice(mainOpen.index + mainOpen[0].length, mainClose);
  } else {
    const bodyOpen = /<body\b[^>]*>/i.exec(html);
    const bodyClose = html.toLowerCase().lastIndexOf("</body>");
    inner = bodyOpen ? html.slice(bodyOpen.index + bodyOpen[0].length, bodyClose > bodyOpen.index ? bodyClose : undefined) : html;
    inner = inner.replace(/<!doctype[^>]*>|<\/?(html|head|body)\b[^>]*>/gi, "").replace(/<head\b[\s\S]*?<\/head>/i, "");
  }
  return inner
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .trim();
}

/**
 * The CMS snippet of a full Grounding Page. `css` (already scoped to .grounding-page) is put
 * inside the wrapper when the design should travel with it.
 */
export function buildCmsSnippet(html: string, opts: { css?: string | null } = {}): string {
  const comment = /<!--\s*Grounding Page Standard[\s\S]*?-->/i.exec(html)?.[0] ?? null;
  const content = pageContent(html);
  const jsonLd = [...html.matchAll(JSON_LD)].map((m) => m[0]);
  const parts: string[] = [];
  if (comment) parts.push(comment);
  parts.push(`<div class="${SNIPPET_WRAPPER_CLASS}">`);
  if (opts.css) parts.push(`<style>\n${opts.css}\n</style>`);
  parts.push(content);
  parts.push("</div>");
  parts.push(...jsonLd);
  return `${parts.join("\n")}\n`;
}
