import * as cheerio from "cheerio";

import { createServiceClient } from "@/lib/supabase/service";
import {
  USER_AGENT,
  fetchUrlsFromSitemap,
  normaliseUrl,
} from "@/lib/dt/seo/crawl-sitemap";
import { getDtSitePageContent } from "@/lib/dt/seo/search-site-pages";

const INSPECT_TIMEOUT_MS = 15_000;
const SITEMAP_PREVIEW_LIMIT = 80;

export async function loadOrgSitemapDefaults(organisationId: string): Promise<{
  websiteUrl: string | null;
  sitemapUrl: string | null;
}> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("dt_org_config")
    .select("website_url,sitemap_url")
    .eq("organisation_id", organisationId)
    .maybeSingle();

  return {
    websiteUrl: data?.website_url ?? null,
    sitemapUrl: data?.sitemap_url ?? null,
  };
}

/**
 * Live-read a sitemap (or org-configured / website/sitemap.xml fallback) and
 * compare a sample of URLs against the crawl index.
 */
export async function readSitemapForTool(
  organisationId: string,
  sitemapUrlInput?: string | null,
): Promise<string> {
  const defaults = await loadOrgSitemapDefaults(organisationId);
  let sitemapUrl = sitemapUrlInput?.trim() || defaults.sitemapUrl?.trim() || "";

  if (!sitemapUrl && defaults.websiteUrl) {
    try {
      const origin = new URL(defaults.websiteUrl).origin;
      sitemapUrl = `${origin}/sitemap.xml`;
    } catch {
      /* ignore */
    }
  }

  if (!sitemapUrl) {
    return (
      "Keine Sitemap-URL bekannt. Bitte eine Sitemap-URL angeben " +
      "(z. B. https://example.de/sitemap.xml) oder in den SEO-Einstellungen hinterlegen."
    );
  }

  let urls: string[];
  try {
    urls = await fetchUrlsFromSitemap(sitemapUrl);
  } catch (err) {
    return `Sitemap konnte nicht gelesen werden (${sitemapUrl}): ${
      err instanceof Error ? err.message : "unbekannt"
    }`;
  }

  if (urls.length === 0) {
    return `Sitemap ${sitemapUrl} wurde gelesen, enthält aber keine <loc>-URLs.`;
  }

  const supabase = createServiceClient();
  const sample = urls.slice(0, SITEMAP_PREVIEW_LIMIT);
  const { data: crawled } = await supabase
    .from("dt_site_pages")
    .select("url")
    .eq("organisation_id", organisationId)
    .eq("is_excluded", false)
    .in("url", sample);

  const crawledSet = new Set((crawled ?? []).map((r) => r.url));
  // Also match by normalised form
  const normalisedCrawled = new Set(
    [...crawledSet].map((u) => normaliseUrl(u) ?? u),
  );

  let inIndex = 0;
  const missing: string[] = [];
  for (const u of sample) {
    const n = normaliseUrl(u) ?? u;
    if (crawledSet.has(u) || normalisedCrawled.has(n)) {
      inIndex += 1;
    } else {
      missing.push(u);
    }
  }

  const lines = [
    `Sitemap gelesen: ${sitemapUrl}`,
    `URLs in Sitemap: ${urls.length}`,
    `Stichprobe gegen Crawl-Index (erste ${sample.length}): ${inIndex} im Index, ${missing.length} nicht im Index.`,
    "",
    "Wichtig: „nicht im Crawl-Index“ heißt nur, dass unser Crawler die Seite noch nicht gespeichert hat — NICHT, dass Google sie nicht indexiert.",
    "Für Live-Erreichbarkeit/noindex nutze `inspect_website_url`. Für Indexierung bei Google fehlen uns GSC-Coverage-Daten.",
    "",
    "Beispiel-URLs aus der Sitemap:",
    ...sample.slice(0, 40).map((u, i) => `${i + 1}. ${u}`),
  ];

  if (urls.length > 40) {
    lines.push(`… und ${urls.length - 40} weitere.`);
  }

  if (missing.length > 0) {
    lines.push("", "In der Stichprobe noch nicht im Crawl-Index (Auszug):");
    lines.push(...missing.slice(0, 15).map((u) => `- ${u}`));
    if (missing.length > 15) lines.push(`… und ${missing.length - 15} weitere.`);
    lines.push(
      "Empfehlung: SEO-Einstellungen → „Jetzt crawlen“, oder einzelne URLs mit `inspect_website_url` live prüfen.",
    );
  }

  return lines.join("\n");
}

export type LiveUrlInspection = {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  ok: boolean;
  contentType: string | null;
  title: string | null;
  metaRobots: string | null;
  xRobotsTag: string | null;
  canonical: string | null;
  noindex: boolean;
  inCrawlIndex: boolean;
  crawlIndexUrl: string | null;
};

/**
 * Live HTTP/meta check for a public URL + whether it exists in our crawl index.
 */
export async function inspectWebsiteUrlForTool(
  organisationId: string,
  urlInput: string,
): Promise<string> {
  const requestedUrl = urlInput.trim();
  if (!requestedUrl) return "Keine URL angegeben.";

  let parsed: URL;
  try {
    parsed = new URL(requestedUrl);
  } catch {
    return `Ungültige URL: ${requestedUrl}`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Nur http/https-URLs sind erlaubt.";
  }

  const crawled = await getDtSitePageContent(organisationId, requestedUrl);

  let res: Response;
  try {
    res = await fetch(requestedUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml,text/xml,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(INSPECT_TIMEOUT_MS),
    });
  } catch (err) {
    return [
      `Live-Abruf fehlgeschlagen für ${requestedUrl}: ${
        err instanceof Error ? err.message : "unbekannt"
      }`,
      `Im Crawl-Index: ${crawled ? `ja (${crawled.url})` : "nein"}`,
    ].join("\n");
  }

  const contentType = res.headers.get("content-type");
  const xRobotsTag = res.headers.get("x-robots-tag");
  const finalUrl = res.url || requestedUrl;

  let title: string | null = null;
  let metaRobots: string | null = null;
  let canonical: string | null = null;

  const ct = (contentType ?? "").toLowerCase();
  if (res.ok && (ct.includes("html") || ct.includes("xml") || ct.includes("text/"))) {
    const html = await res.text();
    if (ct.includes("html") || html.includes("<html") || html.includes("<title")) {
      const $ = cheerio.load(html);
      title = $("title").first().text().replace(/\s+/g, " ").trim() || null;
      metaRobots =
        $('meta[name="robots"]').attr("content")?.replace(/\s+/g, " ").trim() ||
        $('meta[name="googlebot"]').attr("content")?.replace(/\s+/g, " ").trim() ||
        null;
      canonical =
        $('link[rel="canonical"]').attr("href")?.trim() ||
        $('meta[property="og:url"]').attr("content")?.trim() ||
        null;
    } else {
      title = "(kein HTML — z. B. XML/Text)";
    }
  }

  const robotsBlob = `${metaRobots ?? ""} ${xRobotsTag ?? ""}`.toLowerCase();
  const noindex = /\bnoindex\b/.test(robotsBlob);

  const inspection: LiveUrlInspection = {
    requestedUrl,
    finalUrl,
    httpStatus: res.status,
    ok: res.ok,
    contentType,
    title,
    metaRobots,
    xRobotsTag,
    canonical,
    noindex,
    inCrawlIndex: Boolean(crawled),
    crawlIndexUrl: crawled?.url ?? null,
  };

  return [
    `Live-Prüfung: ${inspection.requestedUrl}`,
    `Final-URL: ${inspection.finalUrl}`,
    `HTTP-Status: ${inspection.httpStatus}${inspection.ok ? " (ok)" : ""}`,
    `Content-Type: ${inspection.contentType ?? "—"}`,
    `Title: ${inspection.title ?? "—"}`,
    `Meta-Robots: ${inspection.metaRobots ?? "—"}`,
    `X-Robots-Tag: ${inspection.xRobotsTag ?? "—"}`,
    `Canonical: ${inspection.canonical ?? "—"}`,
    `noindex: ${inspection.noindex ? "JA" : "nein"}`,
    `Im DigitalTwin-Crawl-Index: ${
      inspection.inCrawlIndex
        ? `ja (${inspection.crawlIndexUrl})`
        : "nein (Seite kann trotzdem öffentlich/indexierbar sein)"
    }`,
    "",
    "Hinweis: Das ist ein Live-HTTP-Check unsererseits — kein Google-Indexierungsstatus. GSC-Coverage wird aktuell nicht synchronisiert.",
  ].join("\n");
}
