import * as cheerio from "cheerio";

import { USER_AGENT } from "@/lib/dt/seo/crawl-sitemap";
import { checkSafePublicUrl } from "@/lib/shared/safe-fetch-url";

const PROBE_TIMEOUT_MS = 8_000;

/** Common grounding page paths relative to the org website origin. */
export const GROUNDING_PAGE_PATH_CANDIDATES = [
  "/grounding/",
  "/grounding",
  "/grounding-page/",
  "/grounding-page",
  "/geo-grounding/",
] as const;

export const LLMS_TXT_PATH_CANDIDATES = ["/llms.txt", "/.well-known/llms.txt"] as const;

/**
 * Build absolute candidate URLs for a grounding page from the org website URL.
 */
export function buildGroundingPageUrlCandidates(websiteUrl: string): string[] {
  const safe = checkSafePublicUrl(websiteUrl);
  if (!safe.ok) return [];

  const origin = safe.url.origin;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const path of GROUNDING_PAGE_PATH_CANDIDATES) {
    try {
      const abs = new URL(path, `${origin}/`).toString();
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push(abs);
    } catch {
      /* ignore */
    }
  }

  return out;
}

export function buildLlmsTxtUrlCandidates(websiteUrl: string): string[] {
  const safe = checkSafePublicUrl(websiteUrl);
  if (!safe.ok) return [];
  const origin = safe.url.origin;
  return LLMS_TXT_PATH_CANDIDATES.map((path) => new URL(path, `${origin}/`).toString());
}

function normalizeLinkText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function isLegalNavLabel(text: string): boolean {
  const t = normalizeLinkText(text);
  return (
    t === "impressum" ||
    t.includes("datenschutz") ||
    t.includes("privatsphäre") ||
    t.includes("privacy")
  );
}

function isGroundingNavLabel(text: string): boolean {
  const t = normalizeLinkText(text);
  return t === "grounding" || t.includes("grounding");
}

/**
 * Find the Grounding link in the footer / legal nav (next to Impressum & Datenschutz).
 * Pure helper for unit tests.
 */
export function extractGroundingUrlFromFooterHtml(
  html: string,
  baseUrl: string,
): string | null {
  const safeBase = checkSafePublicUrl(baseUrl);
  if (!safeBase.ok) return null;

  const $ = cheerio.load(html);
  const scopes = ["footer", "[role='contentinfo']", "body"];

  for (const scope of scopes) {
    const roots = $(scope).toArray();
    for (const rootEl of roots) {
      const root = $(rootEl);

      // Prefer nav/ul blocks that already contain Impressum/Datenschutz.
      const legalBlocks = root
        .find("ul, nav, .elementor-nav-menu, menu")
        .toArray()
        .filter((el) => {
          const texts = $(el)
            .find("a")
            .toArray()
            .map((a) => normalizeLinkText($(a).text()));
          return texts.some(isLegalNavLabel);
        });

      const searchRoots = legalBlocks.length > 0 ? legalBlocks : [rootEl];

      for (const block of searchRoots) {
        for (const a of $(block).find("a").toArray()) {
          const href = ($(a).attr("href") ?? "").trim();
          if (!href || href.startsWith("#") || href.startsWith("mailto:")) continue;
          if (!isGroundingNavLabel($(a).text()) && !/grounding/i.test(href)) continue;
          try {
            const abs = new URL(href, safeBase.url).toString();
            const checked = checkSafePublicUrl(abs);
            if (!checked.ok) continue;
            return checked.url.toString();
          } catch {
            continue;
          }
        }
      }
    }
  }

  return null;
}

export type DiscoverGroundingPageResult =
  | {
      ok: true;
      url: string;
      status: number;
      title: string | null;
      source: "footer" | "path_probe";
    }
  | { ok: false; message: string; tried: string[] };

export type LlmsTxtCheckResult =
  | {
      ok: true;
      url: string;
      lastModified: string | null;
      contentType: string | null;
      bytes: number;
    }
  | { ok: false; message: string; tried: string[] };

function looksLikeGroundingHtml(html: string, finalUrl: string): boolean {
  const lower = html.toLowerCase();
  const urlLower = finalUrl.toLowerCase();
  if (urlLower.includes("/grounding")) return true;
  if (/<title>[^<]*grounding[^<]*<\/title>/i.test(html)) return true;
  if (lower.includes("grounding page") || lower.includes("maschinenlesbare")) return true;
  if (/seite wurde nicht gefunden|page not found|404/.test(lower) && html.length < 8_000) {
    return false;
  }
  return false;
}

async function fetchText(
  url: string,
  accept: string,
): Promise<{
  ok: boolean;
  status: number;
  finalUrl: string;
  contentType: string | null;
  lastModified: string | null;
  body: string;
} | null> {
  const safe = checkSafePublicUrl(url);
  if (!safe.ok) return null;
  try {
    const res = await fetch(safe.url.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: accept,
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const contentType = res.headers.get("content-type");
    const lastModified = res.headers.get("last-modified");
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url || safe.url.toString(),
      contentType,
      lastModified,
      body,
    };
  } catch {
    return null;
  }
}

/**
 * Probe homepage footer first, then typical /grounding(-page)/ paths.
 */
export async function discoverGroundingPageUrl(
  websiteUrl: string | null | undefined,
): Promise<DiscoverGroundingPageResult> {
  const safeSite = checkSafePublicUrl(websiteUrl ?? "");
  if (!safeSite.ok) {
    return {
      ok: false,
      message:
        "Keine Website-URL in den SEO-Einstellungen — Grounding-URL kann nicht automatisch gefunden werden.",
      tried: [],
    };
  }

  const tried: string[] = [safeSite.url.toString()];

  // 1) Footer / legal nav on the homepage (Grounding next to Impressum & Datenschutz).
  const home = await fetchText(
    safeSite.url.toString(),
    "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  );
  if (home?.ok) {
    const fromFooter = extractGroundingUrlFromFooterHtml(home.body, home.finalUrl);
    if (fromFooter) {
      tried.push(fromFooter);
      const page = await fetchText(
        fromFooter,
        "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      );
      if (page?.ok) {
        const titleMatch = page.body.match(/<title[^>]*>([^<]*)<\/title>/i);
        return {
          ok: true,
          url: page.finalUrl.endsWith("/") || page.finalUrl.includes("?")
            ? page.finalUrl
            : `${page.finalUrl}/`,
          status: page.status,
          title: titleMatch?.[1]?.trim() || null,
          source: "footer",
        };
      }
      // Footer link exists even if follow-up fetch fails — still return it.
      return {
        ok: true,
        url: fromFooter,
        status: 200,
        title: null,
        source: "footer",
      };
    }
  }

  // 2) Fallback: common path probes.
  const pathCandidates = buildGroundingPageUrlCandidates(safeSite.url.toString());
  for (const candidate of pathCandidates) {
    tried.push(candidate);
    const page = await fetchText(
      candidate,
      "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    );
    if (!page?.ok) continue;
    const ct = (page.contentType ?? "").toLowerCase();
    if (!ct.includes("html") && !ct.includes("text/")) continue;
    if (!looksLikeGroundingHtml(page.body, page.finalUrl)) continue;
    const titleMatch = page.body.match(/<title[^>]*>([^<]*)<\/title>/i);
    return {
      ok: true,
      url: page.finalUrl.endsWith("/") || page.finalUrl.includes("?")
        ? page.finalUrl
        : `${page.finalUrl}/`,
      status: page.status,
      title: titleMatch?.[1]?.trim() || null,
      source: "path_probe",
    };
  }

  return {
    ok: false,
    message: `Keine Grounding Page im Footer oder unter typischen Pfaden gefunden (z. B. ${pathCandidates[0] ?? "/grounding/"}).`,
    tried,
  };
}

/**
 * Check whether llms.txt is publicly available (usually shipped with the grounding page).
 * Prefers an explicit override URL when provided.
 */
export async function checkLlmsTxt(
  websiteUrl: string | null | undefined,
  preferredUrl?: string | null,
): Promise<LlmsTxtCheckResult> {
  const preferred = preferredUrl?.trim() || "";
  const tried = [
    ...(preferred ? [preferred] : []),
    ...buildLlmsTxtUrlCandidates(websiteUrl ?? ""),
  ].filter((u, i, arr) => arr.indexOf(u) === i);

  if (tried.length === 0) {
    return {
      ok: false,
      message: "Keine Website-URL — llms.txt kann nicht geprüft werden.",
      tried: [],
    };
  }

  for (const candidate of tried) {
    const page = await fetchText(candidate, "text/plain,*/*;q=0.8");
    if (!page?.ok) continue;
    const ct = (page.contentType ?? "").toLowerCase();
    // Accept text/plain or generic; reject obvious HTML soft-404s.
    if (ct.includes("html") && !page.body.trimStart().startsWith("#")) continue;
    if (page.body.trim().length < 20) continue;
    return {
      ok: true,
      url: page.finalUrl,
      lastModified: page.lastModified
        ? (() => {
            const d = new Date(page.lastModified);
            return Number.isNaN(d.getTime()) ? null : d.toISOString();
          })()
        : null,
      contentType: page.contentType,
      bytes: page.body.length,
    };
  }

  return {
    ok: false,
    message: `llms.txt nicht gefunden (geprüft: ${tried.join(", ")}).`,
    tried,
  };
}
