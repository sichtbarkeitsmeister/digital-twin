import { USER_AGENT } from "@/lib/dt/seo/crawl-sitemap";
import { checkSafePublicUrl } from "@/lib/shared/safe-fetch-url";

const PROBE_TIMEOUT_MS = 8_000;

/** Common grounding page paths relative to the org website origin. */
export const GROUNDING_PAGE_PATH_CANDIDATES = [
  "/grounding/",
  "/grounding",
  "/llms/",
  "/geo-grounding/",
] as const;

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

export type DiscoverGroundingPageResult =
  | { ok: true; url: string; status: number; title: string | null }
  | { ok: false; message: string; tried: string[] };

function looksLikeGroundingHtml(html: string, finalUrl: string): boolean {
  const lower = html.toLowerCase();
  const urlLower = finalUrl.toLowerCase();
  if (urlLower.includes("/grounding")) return true;
  if (/<title>[^<]*grounding[^<]*<\/title>/i.test(html)) return true;
  if (lower.includes("grounding page") || lower.includes("maschinenlesbare")) return true;
  // Soft-404 heuristics
  if (/seite wurde nicht gefunden|page not found|404/.test(lower) && html.length < 8_000) {
    return false;
  }
  return false;
}

/**
 * Probe likely grounding URLs derived from the organisation website.
 */
export async function discoverGroundingPageUrl(
  websiteUrl: string | null | undefined,
): Promise<DiscoverGroundingPageResult> {
  const tried = buildGroundingPageUrlCandidates(websiteUrl ?? "");
  if (tried.length === 0) {
    return {
      ok: false,
      message:
        "Keine Website-URL in den SEO-Einstellungen — Grounding-URL kann nicht automatisch gefunden werden.",
      tried: [],
    };
  }

  for (const candidate of tried) {
    const safe = checkSafePublicUrl(candidate);
    if (!safe.ok) continue;

    try {
      const res = await fetch(safe.url.toString(), {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) continue;

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.includes("html") && !contentType.includes("text/")) continue;

      const html = await res.text();
      const finalUrl = res.url || safe.url.toString();
      if (!looksLikeGroundingHtml(html, finalUrl)) continue;

      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      return {
        ok: true,
        url: finalUrl.endsWith("/") || finalUrl.includes("?")
          ? finalUrl
          : `${finalUrl}/`,
        status: res.status,
        title: titleMatch?.[1]?.trim() || null,
      };
    } catch {
      continue;
    }
  }

  return {
    ok: false,
    message: `Keine Grounding Page unter typischen Pfaden gefunden (z. B. ${tried[0]}).`,
    tried,
  };
}
