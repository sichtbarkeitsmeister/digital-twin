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

export type GroundingNamedFact = {
  at: string;
  sourceLabel: string;
};

export type GroundingReviewerFact = {
  name: string;
  sourceLabel: string;
};

export type GroundingLiveFacts = {
  lastReviewed: GroundingNamedFact | null;
  dateModified: GroundingNamedFact | null;
  reviewedBy: GroundingReviewerFact | null;
};

export type DetectGroundingPageDateResult =
  | {
      ok: true;
      url: string;
      finalUrl: string;
      /** Best modified/published signal. Null when the page only exposes a review date. */
      detectedAt: string | null;
      /** True when detectedAt comes from an upload/modified signal, not from lastReviewed. */
      appliesToUpload: boolean;
      source: GroundingDateSignalSource | "jsonld_last_reviewed" | "visible_review" | null;
      sourceLabel: string;
      signals: GroundingDateSignal[];
      lastReviewed: GroundingNamedFact | null;
      dateModified: GroundingNamedFact | null;
      reviewedBy: GroundingReviewerFact | null;
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

const MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  märz: 3,
  maerz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};

function isoNoonUtc(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString();
}

function isFutureUtcDay(iso: string, now: Date): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return true;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return day > today;
}

/** Parse a calendar date from ISO, German numeric, or “9. Oktober 2026”. */
export function parseGroundingCalendarDate(
  raw: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const text = raw?.trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const at = isoNoonUtc(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (!at || isFutureUtcDay(at, now)) return null;
    return at;
  }

  const numeric = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (numeric) {
    const at = isoNoonUtc(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
    if (!at || isFutureUtcDay(at, now)) return null;
    return at;
  }

  const named = text.match(/^(\d{1,2})\.?\s+([A-Za-zäöüÄÖÜ]+)\s+(\d{4})$/);
  if (named) {
    const month = MONTHS[named[2]!.toLowerCase()];
    if (!month) return null;
    const at = isoNoonUtc(Number(named[3]), month, Number(named[1]));
    if (!at || isFutureUtcDay(at, now)) return null;
    return at;
  }

  const parsed = parseHttpDate(text);
  if (!parsed || isFutureUtcDay(parsed, now)) return null;
  return parsed;
}

function reviewerName(value: unknown): string | null {
  if (typeof value === "string") {
    const name = value.trim();
    return name.length >= 2 ? name.slice(0, 160) : null;
  }
  if (Array.isArray(value)) {
    const names = value.map(reviewerName).filter((name): name is string => Boolean(name));
    return names.length > 0 ? names.join(", ").slice(0, 160) : null;
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return reviewerName(rec.name);
  }
  return null;
}

function isWebPageType(value: unknown): boolean {
  const types = Array.isArray(value) ? value : [value];
  return types.some((item) => typeof item === "string" && /webpage/i.test(item));
}

type JsonLdReview = {
  lastReviewed: string | null;
  dateModified: string | null;
  reviewedBy: string | null;
  webPage: boolean;
};

function walkJsonLdReview(node: unknown, out: JsonLdReview[], now: Date) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLdReview(item, out, now);
    return;
  }
  if (typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  const lastReviewed =
    typeof rec.lastReviewed === "string" ? parseGroundingCalendarDate(rec.lastReviewed, now) : null;
  const dateModified =
    typeof rec.dateModified === "string" ? parseGroundingCalendarDate(rec.dateModified, now) : null;
  const reviewedBy = reviewerName(rec.reviewedBy);
  if (lastReviewed || dateModified || reviewedBy) {
    out.push({
      lastReviewed,
      dateModified,
      reviewedBy,
      webPage: isWebPageType(rec["@type"]),
    });
  }
  if (rec["@graph"]) walkJsonLdReview(rec["@graph"], out, now);
}

function preferWebPage<T extends { webPage: boolean }>(rows: T[]): T | null {
  return rows.find((row) => row.webPage) ?? rows[0] ?? null;
}

function visibleReview(text: string, now: Date): { at: string | null; reviewer: string | null } {
  const compact = text.replace(/\s+/g, " ");
  const dateMatch = compact.match(
    /(?:zuletzt\s+geprüft|zuletzt\s+geprueft|geprüft\s+am|geprueft\s+am|lastReviewed)\s*[:\-]?\s*(\d{1,2}\.\d{1,2}\.\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\.?\s+[A-Za-zäöüÄÖÜ]+\s+\d{4})/i,
  );
  const reviewerMatch = compact.match(
    /(?:geprüft\s+von|geprueft\s+von|Prüfer|Pruefer|reviewedBy)\s*[:\-]\s*([A-Za-zÄÖÜäöüß][^,.;]{1,80})/i,
  );
  const reviewer = reviewerMatch?.[1]?.trim().replace(/\s+/g, " ") ?? null;
  return {
    at: dateMatch ? parseGroundingCalendarDate(dateMatch[1], now) : null,
    reviewer: reviewer && reviewer.length >= 2 ? reviewer.slice(0, 160) : null,
  };
}

/**
 * Review and modification facts from HTML.
 * lastReviewed is never filled from dateModified.
 */
export function extractGroundingLiveFacts(input: {
  html?: string | null;
  httpLastModified?: string | null;
  now?: Date;
}): GroundingLiveFacts {
  const now = input.now ?? new Date();
  const reviews: JsonLdReview[] = [];
  let metaModified: string | null = null;
  let visibleLastReviewed: string | null = null;
  let visibleReviewer: string | null = null;

  if (input.html?.trim()) {
    const $ = cheerio.load(input.html);
    $("script, style, noscript").remove();
    const visible = visibleReview($("body").length ? $("body").text() : $.root().text(), now);
    visibleLastReviewed = visible.at;
    visibleReviewer = visible.reviewer;

    const fresh = cheerio.load(input.html);
    metaModified =
      parseGroundingCalendarDate(
        fresh('meta[property="article:modified_time"]').attr("content") ??
          fresh('meta[name="article:modified_time"]').attr("content"),
        now,
      ) ??
      parseGroundingCalendarDate(fresh('meta[property="og:updated_time"]').attr("content"), now);

    fresh('script[type="application/ld+json"]').each((_, el) => {
      const raw = fresh(el).text();
      if (!raw.trim()) return;
      try {
        walkJsonLdReview(JSON.parse(raw), reviews, now);
      } catch {
        /* ignore invalid JSON-LD */
      }
    });
  }

  const reviewed = preferWebPage(reviews.filter((row) => row.lastReviewed));
  const modified = preferWebPage(reviews.filter((row) => row.dateModified));
  const reviewer = preferWebPage(reviews.filter((row) => row.reviewedBy));
  const headerModified = parseGroundingCalendarDate(input.httpLastModified, now);

  const dateModified = modified?.dateModified
    ? { at: modified.dateModified, sourceLabel: "JSON-LD dateModified" }
    : metaModified
      ? { at: metaModified, sourceLabel: "Meta-Tags" }
      : headerModified
        ? { at: headerModified, sourceLabel: "HTTP-Header Last-Modified" }
        : null;

  return {
    lastReviewed: reviewed?.lastReviewed
      ? { at: reviewed.lastReviewed, sourceLabel: "JSON-LD lastReviewed" }
      : visibleLastReviewed
        ? { at: visibleLastReviewed, sourceLabel: "sichtbarer Prüfhinweis" }
        : null,
    dateModified,
    reviewedBy: reviewer?.reviewedBy
      ? { name: reviewer.reviewedBy, sourceLabel: "JSON-LD reviewedBy" }
      : visibleReviewer
        ? { name: visibleReviewer, sourceLabel: "sichtbarer Prüfhinweis" }
        : null,
  };
}

/**
 * Live-fetch a grounding page URL and infer upload, modification and review dates.
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

  const httpLastModified = res.headers.get("last-modified");
  const signals: GroundingDateSignal[] = [];
  pushSignal(signals, "http_last_modified", httpLastModified);

  let html = "";
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("html") || contentType.includes("xml") || contentType.includes("text/")) {
    try {
      html = await res.text();
      signals.push(...extractGroundingDateSignalsFromHtml(html));
    } catch {
      /* header-only fallback */
    }
  }

  const facts = extractGroundingLiveFacts({ html, httpLastModified });
  const best = pickBestGroundingDateSignal(signals);
  if (!best && !facts.lastReviewed && !facts.dateModified) {
    return {
      ok: false,
      message:
        "Kein Datum auf der Seite gefunden (weder Last-Modified noch Meta/JSON-LD/Prüfhinweis). Bitte manuell setzen.",
    };
  }

  return {
    ok: true,
    url: safe.url.toString(),
    finalUrl: res.url || safe.url.toString(),
    detectedAt: best?.at ?? null,
    appliesToUpload: Boolean(best),
    source: best?.source ?? null,
    sourceLabel:
      best?.label ??
      facts.lastReviewed?.sourceLabel ??
      facts.dateModified?.sourceLabel ??
      "kein Upload-Datum",
    signals,
    lastReviewed: facts.lastReviewed,
    dateModified: facts.dateModified,
    reviewedBy: facts.reviewedBy,
  };
}

/** Columns to persist. Review dates are never copied into the upload timestamp. */
export function groundingDateColumnsFromDetection(
  detected: Extract<DetectGroundingPageDateResult, { ok: true }>,
): Record<string, string> {
  const patch: Record<string, string> = {};
  if (detected.appliesToUpload && detected.detectedAt) {
    patch.grounding_page_uploaded_at = detected.detectedAt;
  }
  if (detected.dateModified) patch.grounding_page_date_modified = detected.dateModified.at;
  if (detected.lastReviewed) patch.grounding_page_last_reviewed = detected.lastReviewed.at;
  if (detected.reviewedBy) patch.grounding_page_reviewed_by = detected.reviewedBy.name;
  return patch;
}
