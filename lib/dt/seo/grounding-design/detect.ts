/**
 * Live design detection for Vercel (no headless browser): the homepage — or the HTML the
 * crawl step already fetched — and at most MAX_STYLESHEETS same-origin stylesheets of at most
 * MAX_STYLESHEET_BYTES each, every hop through the safe-fetch rules. Two rounds: the theme
 * CSS first, then the font CSS of the families it names (so a self-hosted font is found even
 * on sites with dozens of stylesheets). External stylesheets
 * (Google Fonts, CDNs) are never fetched; they only count as evidence of external fonts.
 */

import { PAGE_TIMEOUT_MS } from "@/lib/dt/seo/crawl-sitemap";
import { HTML_ACCEPT, safeFetchText } from "@/lib/dt/seo/grounding-check/fetch";
import {
  MAX_STYLESHEETS,
  MAX_STYLESHEET_BYTES,
  type DesignExtraction,
  extractDesign,
  fontStylesheetsToFetch,
  isFontStylesheet,
  stylesheetLinks,
  stylesheetsToFetch,
} from "@/lib/dt/seo/grounding-design/extract";
import { isOwnOrigin } from "@/lib/dt/seo/grounding-design/origin";

const CSS_ACCEPT = "text/css,*/*;q=0.1";
const CSS_TIMEOUT_MS = 8_000;
/** Up to this many of the five sheets are kept for font CSS (small, decides the font rule). */
const FONT_SHEETS = 2;

export type DesignDetectionResult =
  | ({ ok: true; pageUrl: string } & DesignExtraction)
  | { ok: false; message: string };

/**
 * Detect the design of `websiteUrl`. Pass `home` when the raw homepage HTML is at hand (the
 * crawl step of a Grounding check), so it is not fetched twice. `deadline` (epoch ms) stops
 * stylesheet fetches that would end after it.
 */
export async function detectGroundingDesign(input: {
  websiteUrl: string;
  home?: { url: string; html: string } | null;
  deadline?: number;
}): Promise<DesignDetectionResult> {
  let pageUrl: string;
  let html: string;
  if (input.home?.html) {
    pageUrl = input.home.url;
    html = input.home.html;
  } else {
    const res = await safeFetchText(input.websiteUrl, { accept: HTML_ACCEPT, timeoutMs: PAGE_TIMEOUT_MS });
    if (!res) return { ok: false, message: "Die Website ist nicht erreichbar oder die Adresse ist nicht erlaubt." };
    if (!res.ok) return { ok: false, message: `Die Website antwortet mit HTTP ${res.status}.` };
    if (!/html/i.test(res.contentType)) return { ok: false, message: "Die Startseite liefert kein HTML." };
    pageUrl = res.finalUrl;
    html = res.body;
  }

  const deadline = input.deadline ?? Date.now() + 20_000;
  const links = stylesheetLinks(html, pageUrl);
  const sheets: Record<string, string> = {};
  const fetchAll = async (urls: string[]) => {
    const timeoutMs = Math.min(CSS_TIMEOUT_MS, Math.max(0, deadline - Date.now()));
    if (timeoutMs < 1_000) return;
    const results = await Promise.all(
      urls.map(async (url) => {
        const res = await safeFetchText(url, { accept: CSS_ACCEPT, timeoutMs, maxBytes: MAX_STYLESHEET_BYTES });
        // A redirect to another host is not the client's own CSS.
        if (!res?.ok || !isOwnOrigin(res.finalUrl, pageUrl) || /html/i.test(res.contentType)) return null;
        return [url, res.body] as const;
      }),
    );
    for (const r of results) if (r) sheets[r[0]] = r[1];
  };

  // Phase 1: theme CSS (colours, which fonts); phase 2: the font sheets of those fonts.
  const fontSheets = links.filter((l) => l.sameOrigin && isFontStylesheet(l.url)).length;
  const phase1 = stylesheetsToFetch(links, MAX_STYLESHEETS - Math.min(FONT_SHEETS, fontSheets));
  await fetchAll(phase1);
  const first = extractDesign({ pageUrl, html, stylesheets: sheets });
  const families = [...first.report.fontFamilies.body.slice(0, 1), ...first.report.fontFamilies.heading.slice(0, 1)];
  await fetchAll(fontStylesheetsToFetch(links, families, MAX_STYLESHEETS - phase1.length));
  return { ok: true, pageUrl, ...extractDesign({ pageUrl, html, stylesheets: sheets }) };
}
