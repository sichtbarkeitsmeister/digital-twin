import * as cheerio from "cheerio";

import { createServiceClient } from "@/lib/supabase/service";
import {
  USER_AGENT,
  fetchUrlsFromSitemap,
  normaliseUrl,
} from "@/lib/dt/seo/crawl-sitemap";
import {
  evaluateCanonical,
  formatIndexabilityAudit,
  type DtIndexabilityAuditMeta,
  type DtIndexabilityRow,
} from "@/lib/dt/seo/indexability-audit";
import { getDtSitePageContent } from "@/lib/dt/seo/search-site-pages";

const INSPECT_TIMEOUT_MS = 15_000;
const SITEMAP_PREVIEW_LIMIT = 80;

/** Bulk audit runs inside a chat tool call, so it must stay well below route limits. */
const AUDIT_URL_TIMEOUT_MS = 8_000;
const AUDIT_TOTAL_BUDGET_MS = 20_000;
const AUDIT_CONCURRENCY = 6;
const AUDIT_DEFAULT_LIMIT = 15;
const AUDIT_MAX_LIMIT = 30;

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

type HtmlSignals = {
  title: string | null;
  metaRobots: string | null;
  canonical: string | null;
};

function parseHtmlSignals(html: string, contentType: string | null): HtmlSignals {
  const ct = (contentType ?? "").toLowerCase();
  if (!(ct.includes("html") || html.includes("<html") || html.includes("<title"))) {
    return { title: "(kein HTML — z. B. XML/Text)", metaRobots: null, canonical: null };
  }
  const $ = cheerio.load(html);
  return {
    title: $("title").first().text().replace(/\s+/g, " ").trim() || null,
    metaRobots:
      $('meta[name="robots"]').attr("content")?.replace(/\s+/g, " ").trim() ||
      $('meta[name="googlebot"]').attr("content")?.replace(/\s+/g, " ").trim() ||
      null,
    canonical:
      $('link[rel="canonical"]').attr("href")?.trim() ||
      $('meta[property="og:url"]').attr("content")?.trim() ||
      null,
  };
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
    const signals = parseHtmlSignals(await res.text(), contentType);
    title = signals.title;
    metaRobots = signals.metaRobots;
    canonical = signals.canonical;
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

async function checkUrlIndexability(
  url: string,
  crawledUrls: Set<string>,
): Promise<DtIndexabilityRow> {
  const base: DtIndexabilityRow = {
    url,
    status: null,
    finalUrl: null,
    noindex: false,
    canonical: null,
    canonicalPointsElsewhere: false,
    redirected: false,
    inCrawlIndex: crawledUrls.has(normaliseUrl(url) ?? url) || crawledUrls.has(url),
    error: null,
  };

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(AUDIT_URL_TIMEOUT_MS),
    });

    const contentType = res.headers.get("content-type");
    const xRobotsTag = res.headers.get("x-robots-tag");
    const finalUrl = res.url || url;

    let signals = { title: null as string | null, metaRobots: null as string | null, canonical: null as string | null };
    const ct = (contentType ?? "").toLowerCase();
    if (res.ok && (ct.includes("html") || ct.includes("text/"))) {
      signals = parseHtmlSignals(await res.text(), contentType);
    }

    const robotsBlob = `${signals.metaRobots ?? ""} ${xRobotsTag ?? ""}`.toLowerCase();

    return {
      ...base,
      status: res.status,
      finalUrl,
      noindex: /\bnoindex\b/.test(robotsBlob),
      canonical: signals.canonical,
      canonicalPointsElsewhere: evaluateCanonical(url, finalUrl, signals.canonical),
      redirected: finalUrl !== url,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unbekannt";
    return { ...base, error: message.includes("timeout") ? "Zeitüberschreitung" : message };
  }
}

/**
 * Checks many URLs at once for technical blockers (HTTP errors, noindex,
 * foreign canonical, redirects) and compares them with the crawl index.
 */
export async function auditSiteIndexabilityForTool(
  organisationId: string,
  input: { sitemapUrl?: string | null; urls?: string[] | null; limit?: number | null },
): Promise<string> {
  const limit = Math.min(
    Math.max(input.limit ?? AUDIT_DEFAULT_LIMIT, 1),
    AUDIT_MAX_LIMIT,
  );

  let candidates: string[] = [];
  let meta: Pick<DtIndexabilityAuditMeta, "source" | "sourceLabel"> = {
    source: "explicit",
    sourceLabel: "übergebene URLs",
  };

  const explicit = (input.urls ?? []).map((u) => u.trim()).filter(Boolean);
  if (explicit.length > 0) {
    candidates = explicit;
  } else {
    const defaults = await loadOrgSitemapDefaults(organisationId);
    let sitemapUrl = input.sitemapUrl?.trim() || defaults.sitemapUrl?.trim() || "";
    if (!sitemapUrl && defaults.websiteUrl) {
      try {
        sitemapUrl = `${new URL(defaults.websiteUrl).origin}/sitemap.xml`;
      } catch {
        /* ignore */
      }
    }

    if (sitemapUrl) {
      try {
        candidates = await fetchUrlsFromSitemap(sitemapUrl);
        meta = { source: "sitemap", sourceLabel: `Sitemap ${sitemapUrl}` };
      } catch {
        candidates = [];
      }
    }

    if (candidates.length === 0) {
      const supabase = createServiceClient();
      const { data } = await supabase
        .from("dt_site_pages")
        .select("url")
        .eq("organisation_id", organisationId)
        .eq("is_excluded", false)
        .order("url", { ascending: true })
        .limit(AUDIT_MAX_LIMIT);
      candidates = (data ?? []).map((row) => row.url as string);
      meta = { source: "crawl_index", sourceLabel: "Crawl-Index" };
    }
  }

  if (candidates.length === 0) {
    return formatIndexabilityAudit([], {
      ...meta,
      totalCandidates: 0,
      checked: 0,
      stoppedEarly: false,
    });
  }

  const selected = candidates.slice(0, limit);

  const supabase = createServiceClient();
  const { data: crawled } = await supabase
    .from("dt_site_pages")
    .select("url")
    .eq("organisation_id", organisationId)
    .eq("is_excluded", false)
    .in("url", selected);

  const crawledUrls = new Set<string>();
  for (const row of crawled ?? []) {
    const url = row.url as string;
    crawledUrls.add(url);
    const normalised = normaliseUrl(url);
    if (normalised) crawledUrls.add(normalised);
  }

  const deadline = Date.now() + AUDIT_TOTAL_BUDGET_MS;
  const rows: DtIndexabilityRow[] = [];
  let stoppedEarly = false;

  for (let i = 0; i < selected.length; i += AUDIT_CONCURRENCY) {
    if (Date.now() >= deadline) {
      stoppedEarly = true;
      break;
    }
    const batch = selected.slice(i, i + AUDIT_CONCURRENCY);
    const results = await Promise.all(
      batch.map((url) => checkUrlIndexability(url, crawledUrls)),
    );
    rows.push(...results);
  }

  return formatIndexabilityAudit(rows, {
    ...meta,
    totalCandidates: candidates.length,
    checked: rows.length,
    stoppedEarly,
  });
}
