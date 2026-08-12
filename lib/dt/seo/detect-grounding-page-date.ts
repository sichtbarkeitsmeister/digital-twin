import * as cheerio from "cheerio";

import { USER_AGENT } from "@/lib/dt/seo/crawl-sitemap";
import { checkSafePublicUrl } from "@/lib/shared/safe-fetch-url";

const FETCH_TIMEOUT_MS = 15_000;

export type GroundingDateSignalSource =
  | "http_last_modified"
  | "meta_article_modified"
  | "meta_og_updated"
  | "meta_article_published"
  | "jsonld_date_modified"
  | "jsonld_date_published";

export type GroundingDateSignal = {
  source: GroundingDateSignalSource;
  at: string;
  label: string;
};

export type DetectGroundingPageDateResult =
  | {
      ok: true;
      url: string;
      finalUrl: string;
      detectedAt: string;
      source: GroundingDateSignalSource;
      sourceLabel: string;
      signals: GroundingDateSignal[];
    }
  | { ok: false; message: string };

const SOURCE_LABELS: Record<GroundingDateSignalSource, string> = {
  http_last_modified: "HTTP Last-Modified",
  meta_article_modified: "Meta article:modified_time",
  meta_og_updated: "Meta og:updated_time",
  meta_article_published: "Meta article:published_time",
  jsonld_date_modified: "JSON-LD dateModified",
  jsonld_date_published: "JSON-LD datePublished",
};

/** Preference: modified signals beat published; within same tier, newest wins. */
const SOURCE_RANK: Record<GroundingDateSignalSource, number> = {
  http_last_modified: 3,
  meta_article_modified: 3,
  meta_og_updated: 3,
  jsonld_date_modified: 3,
  meta_article_published: 1,
  jsonld_date_published: 1,
};

export function parseHttpDate(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function pushSignal(
  out: GroundingDateSignal[],
  source: GroundingDateSignalSource,
  raw: string | null | undefined,
) {
  const at = parseHttpDate(raw);
  if (!at) return;
  out.push({ source, at, label: SOURCE_LABELS[source] });
}

function walkJsonLd(node: unknown, out: GroundingDateSignal[]) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLd(item, out);
    return;
  }
  if (typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  if (typeof rec.dateModified === "string") {
    pushSignal(out, "jsonld_date_modified", rec.dateModified);
  }
  if (typeof rec.datePublished === "string") {
    pushSignal(out, "jsonld_date_published", rec.datePublished);
  }
  if (rec["@graph"]) walkJsonLd(rec["@graph"], out);
}

/** Extract date signals from HTML body (meta + JSON-LD). Pure for tests. */
export function extractGroundingDateSignalsFromHtml(html: string): GroundingDateSignal[] {
  const out: GroundingDateSignal[] = [];
  const $ = cheerio.load(html);

  pushSignal(
    out,
    "meta_article_modified",
    $('meta[property="article:modified_time"]').attr("content") ??
      $('meta[name="article:modified_time"]').attr("content"),
  );
  pushSignal(
    out,
    "meta_og_updated",
    $('meta[property="og:updated_time"]').attr("content"),
  );
  pushSignal(
    out,
    "meta_article_published",
    $('meta[property="article:published_time"]').attr("content") ??
      $('meta[name="article:published_time"]').attr("content") ??
      $('meta[name="date"]').attr("content"),
  );

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    if (!raw.trim()) return;
    try {
      walkJsonLd(JSON.parse(raw), out);
    } catch {
      /* ignore invalid JSON-LD */
    }
  });

  return out;
}

export function pickBestGroundingDateSignal(
  signals: GroundingDateSignal[],
): GroundingDateSignal | null {
  if (signals.length === 0) return null;
  return [...signals].sort((a, b) => {
    const rankDiff = SOURCE_RANK[b.source] - SOURCE_RANK[a.source];
    if (rankDiff !== 0) return rankDiff;
    return b.at.localeCompare(a.at);
  })[0]!;
}

/**
 * Live-fetch a grounding page URL and infer the last upload/update timestamp.
 */
export async function detectGroundingPageUploadedAt(
  urlInput: string,
): Promise<DetectGroundingPageDateResult> {
  const safe = checkSafePublicUrl(urlInput);
  if (!safe.ok) return { ok: false, message: safe.reason };

  let res: Response;
  try {
    res = await fetch(safe.url.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml,text/xml,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      message: `Seite nicht erreichbar: ${err instanceof Error ? err.message : "unbekannt"}`,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      message: `HTTP ${res.status} beim Abruf von ${safe.url.toString()}`,
    };
  }

  const signals: GroundingDateSignal[] = [];
  pushSignal(signals, "http_last_modified", res.headers.get("last-modified"));

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("html") || contentType.includes("xml") || contentType.includes("text/")) {
    try {
      const html = await res.text();
      signals.push(...extractGroundingDateSignalsFromHtml(html));
    } catch {
      /* header-only fallback */
    }
  }

  const best = pickBestGroundingDateSignal(signals);
  if (!best) {
    return {
      ok: false,
      message:
        "Kein Datum auf der Seite gefunden (weder Last-Modified noch Meta/JSON-LD). Bitte manuell setzen.",
    };
  }

  return {
    ok: true,
    url: safe.url.toString(),
    finalUrl: res.url || safe.url.toString(),
    detectedAt: best.at,
    source: best.source,
    sourceLabel: best.label,
    signals,
  };
}
