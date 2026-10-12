import * as cheerio from "cheerio";

import { USER_AGENT } from "@/lib/dt/seo/crawl-sitemap";
import { redirectedToSiteRoot } from "@/lib/dt/seo/discover-grounding-page-url";
import { checkSafePublicUrl } from "@/lib/shared/safe-fetch-url";

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Date signal sources, ordered like the Grounding tool prompt expects when
 * tool data is missing: JSON-LD lastReviewed → JSON-LD dateModified →
 * sichtbarer Prüfhinweis → Meta-Tags → HTTP Last-Modified.
 */
export type GroundingDateSignalSource =
  | "jsonld_last_reviewed"
  | "jsonld_date_modified"
  | "visible_review_notice"
  | "meta_article_modified"
  | "meta_og_updated"
  | "http_last_modified"
  | "meta_article_published"
  | "jsonld_date_published";

export type GroundingDateSignal = {
  source: GroundingDateSignalSource;
  at: string;
  label: string;
};

/** Facts the Grounding tool keeps per page (Standard v1.7). */
export type GroundingPageLiveFacts = {
  /** lastReviewed — JSON-LD WebPage, else sichtbarer Prüfhinweis. */
  lastReviewed: string | null;
  lastReviewedSource: "jsonld_last_reviewed" | "visible_review_notice" | null;
  /** reviewedBy name — JSON-LD, else sichtbarer Prüfhinweis. */
  reviewedBy: string | null;
  /** dateModified — JSON-LD, else Meta, else HTTP Last-Modified. */
  dateModified: string | null;
  dateModifiedSource: GroundingDateSignalSource | null;
  /** Standardversion, die die Seite selbst nennt (z. B. "1.7"). */
  standardVersion: string | null;
  /** True when the visible review notice and JSON-LD disagree (Prüfer oder Datum). */
  reviewMismatch: boolean;
};

export type DetectGroundingPageDateResult =
  | {
      ok: true;
      url: string;
      finalUrl: string;
      /** Best single date for the page (legacy "hochgeladen am"). */
      detectedAt: string;
      source: GroundingDateSignalSource;
      sourceLabel: string;
      signals: GroundingDateSignal[];
      facts: GroundingPageLiveFacts;
    }
  | { ok: false; message: string };

const SOURCE_LABELS: Record<GroundingDateSignalSource, string> = {
  jsonld_last_reviewed: "JSON-LD lastReviewed",
  jsonld_date_modified: "JSON-LD dateModified",
  visible_review_notice: "Sichtbarer Prüfhinweis",
  meta_article_modified: "Meta article:modified_time",
  meta_og_updated: "Meta og:updated_time",
  http_last_modified: "HTTP Last-Modified",
  meta_article_published: "Meta article:published_time",
  jsonld_date_published: "JSON-LD datePublished",
};

/** Higher wins. Mirrors the tool prompt order; published dates are a last resort. */
const SOURCE_RANK: Record<GroundingDateSignalSource, number> = {
  jsonld_last_reviewed: 7,
  jsonld_date_modified: 6,
  visible_review_notice: 5,
  meta_article_modified: 4,
  meta_og_updated: 4,
  http_last_modified: 3,
  meta_article_published: 1,
  jsonld_date_published: 1,
};

const MONTHS_DE: Record<string, number> = {
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

export function parseHttpDate(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Parse dates as they appear in visible page text:
 * 2026-10-12 · 12.10.2026 · 12. Oktober 2026. Returns an ISO string (UTC noon).
 */
export function parseVisibleDate(raw: string | null | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;

  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return toIsoNoon(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dotted = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dotted) return toIsoNoon(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]));

  const spelled = text.match(/(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\s+(\d{4})/);
  if (spelled) {
    const month = MONTHS_DE[spelled[2]!.toLowerCase()];
    if (month) return toIsoNoon(Number(spelled[3]), month, Number(spelled[1]));
  }
  return null;
}

function toIsoNoon(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== month - 1) return null;
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

type JsonLdFacts = {
  reviewedBy: string | null;
};

function reviewerName(node: unknown): string | null {
  if (!node) return null;
  if (typeof node === "string") return node.trim() || null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const name = reviewerName(item);
      if (name) return name;
    }
    return null;
  }
  if (typeof node === "object") {
    const rec = node as Record<string, unknown>;
    if (typeof rec.name === "string" && rec.name.trim()) return rec.name.trim();
  }
  return null;
}

function walkJsonLd(node: unknown, out: GroundingDateSignal[], facts: JsonLdFacts) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLd(item, out, facts);
    return;
  }
  if (typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  if (typeof rec.lastReviewed === "string") {
    pushSignal(out, "jsonld_last_reviewed", rec.lastReviewed);
  }
  if (rec.reviewedBy && !facts.reviewedBy) {
    facts.reviewedBy = reviewerName(rec.reviewedBy);
  }
  if (typeof rec.dateModified === "string") {
    pushSignal(out, "jsonld_date_modified", rec.dateModified);
  }
  if (typeof rec.datePublished === "string") {
    pushSignal(out, "jsonld_date_published", rec.datePublished);
  }
  if (rec["@graph"]) walkJsonLd(rec["@graph"], out, facts);
  if (rec.mainEntityOfPage && typeof rec.mainEntityOfPage === "object") {
    walkJsonLd(rec.mainEntityOfPage, out, facts);
  }
}

export type VisibleReviewNotice = {
  reviewedBy: string | null;
  lastReviewed: string | null;
};

/**
 * Parse the visible Prüfhinweis (Standard v1.7):
 * "Fakten geprüft von [Prüfer] · Zuletzt von einem Menschen geprüft: [Datum]"
 * or the Human-Verified block ("Geprüft von …", "Zuletzt geprüft …").
 * Older labels ("Zuletzt redaktionell geprüft", bare "Geprüft") do not count.
 */
export function parseVisibleReviewNotice(text: string): VisibleReviewNotice {
  const flat = text.replace(/\s+/g, " ");
  let reviewedBy: string | null = null;
  let lastReviewed: string | null = null;

  const byMatch =
    flat.match(/Fakten geprüft von\s+(.+?)(?:\s+[·•|–-]\s+|\s+Zuletzt|$)/i) ??
    flat.match(/Geprüft von\s+(.+?)(?:\s+Zuletzt geprüft|\s+[·•|]|$)/i);
  if (byMatch?.[1]) {
    reviewedBy = byMatch[1].trim().replace(/[.,;:]+$/, "") || null;
  }

  const dateMatch =
    flat.match(/Zuletzt von einem Menschen geprüft:?\s*([^·•|]+)/i) ??
    flat.match(/Zuletzt geprüft:?\s*([^·•|]+)/i);
  if (dateMatch?.[1]) {
    lastReviewed = parseVisibleDate(dateMatch[1]);
  }

  return { reviewedBy, lastReviewed };
}

/** "Grounding Page Standard v1.7" / "Grounding Page Standard 1.7" → "1.7". */
export function parseStandardVersion(text: string): string | null {
  const m = text.match(/Grounding[\s-]*Page[\s-]*Standard\s*(?:v\.?\s*)?(\d+\.\d+)/i);
  return m?.[1] ?? null;
}

export type ExtractedGroundingPageHtml = {
  signals: GroundingDateSignal[];
  jsonLdReviewedBy: string | null;
  visibleNotice: VisibleReviewNotice;
  standardVersion: string | null;
};

/** Extract date signals + review facts from HTML (meta, JSON-LD, visible text). Pure for tests. */
export function extractGroundingPageHtml(html: string): ExtractedGroundingPageHtml {
  const signals: GroundingDateSignal[] = [];
  const $ = cheerio.load(html);

  pushSignal(
    signals,
    "meta_article_modified",
    $('meta[property="article:modified_time"]').attr("content") ??
      $('meta[name="article:modified_time"]').attr("content"),
  );
  pushSignal(
    signals,
    "meta_og_updated",
    $('meta[property="og:updated_time"]').attr("content"),
  );
  pushSignal(
    signals,
    "meta_article_published",
    $('meta[property="article:published_time"]').attr("content") ??
      $('meta[name="article:published_time"]').attr("content") ??
      $('meta[name="date"]').attr("content"),
  );

  const jsonLdFacts: JsonLdFacts = { reviewedBy: null };
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    if (!raw.trim()) return;
    try {
      walkJsonLd(JSON.parse(raw), signals, jsonLdFacts);
    } catch {
      /* ignore invalid JSON-LD */
    }
  });

  $("script, style, noscript").remove();
  const visibleText = $("body").text() || $.root().text();
  const visibleNotice = parseVisibleReviewNotice(visibleText);
  if (visibleNotice.lastReviewed) {
    signals.push({
      source: "visible_review_notice",
      at: visibleNotice.lastReviewed,
      label: SOURCE_LABELS.visible_review_notice,
    });
  }

  const standardVersion =
    parseStandardVersion(visibleText) ?? parseStandardVersion(html);

  return {
    signals,
    jsonLdReviewedBy: jsonLdFacts.reviewedBy,
    visibleNotice,
    standardVersion,
  };
}

/** Backwards-compatible: date signals only. */
export function extractGroundingDateSignalsFromHtml(html: string): GroundingDateSignal[] {
  return extractGroundingPageHtml(html).signals;
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

function firstSignal(
  signals: GroundingDateSignal[],
  sources: GroundingDateSignalSource[],
): GroundingDateSignal | null {
  for (const source of sources) {
    const hit = signals
      .filter((s) => s.source === source)
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    if (hit) return hit;
  }
  return null;
}

function sameDay(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  return a.slice(0, 10) === b.slice(0, 10);
}

function normalizeName(name: string | null): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Combine extracted HTML facts (+ HTTP header signals) into the per-page facts. Pure for tests. */
export function deriveGroundingPageLiveFacts(
  extracted: ExtractedGroundingPageHtml,
  extraSignals: GroundingDateSignal[] = [],
): GroundingPageLiveFacts {
  const signals = [...extracted.signals, ...extraSignals];

  const jsonLdReviewed = firstSignal(signals, ["jsonld_last_reviewed"]);
  const visibleReviewed = extracted.visibleNotice.lastReviewed;
  const lastReviewed = jsonLdReviewed?.at ?? visibleReviewed ?? null;
  const lastReviewedSource = jsonLdReviewed
    ? ("jsonld_last_reviewed" as const)
    : visibleReviewed
      ? ("visible_review_notice" as const)
      : null;

  const reviewedBy = extracted.jsonLdReviewedBy ?? extracted.visibleNotice.reviewedBy ?? null;

  const modified = firstSignal(signals, [
    "jsonld_date_modified",
    "meta_article_modified",
    "meta_og_updated",
    "http_last_modified",
  ]);

  const reviewMismatch =
    (Boolean(jsonLdReviewed) &&
      Boolean(visibleReviewed) &&
      !sameDay(jsonLdReviewed?.at ?? null, visibleReviewed)) ||
    (Boolean(extracted.jsonLdReviewedBy) &&
      Boolean(extracted.visibleNotice.reviewedBy) &&
      normalizeName(extracted.jsonLdReviewedBy) !==
        normalizeName(extracted.visibleNotice.reviewedBy));

  return {
    lastReviewed,
    lastReviewedSource,
    reviewedBy,
    dateModified: modified?.at ?? null,
    dateModifiedSource: modified?.source ?? null,
    standardVersion: extracted.standardVersion,
    reviewMismatch,
  };
}

/**
 * Live-fetch a grounding page URL and read its dates and review facts.
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

  if (res.url && redirectedToSiteRoot(safe.url.toString(), res.url)) {
    return {
      ok: false,
      message: `${safe.url.toString()} leitet auf die Startseite weiter — dort gibt es keine Grounding Page. Datum nicht übernommen; Seite zuerst veröffentlichen.`,
    };
  }

  const headerSignals: GroundingDateSignal[] = [];
  pushSignal(headerSignals, "http_last_modified", res.headers.get("last-modified"));

  let extracted: ExtractedGroundingPageHtml = {
    signals: [],
    jsonLdReviewedBy: null,
    visibleNotice: { reviewedBy: null, lastReviewed: null },
    standardVersion: null,
  };
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("html") || contentType.includes("xml") || contentType.includes("text/")) {
    try {
      extracted = extractGroundingPageHtml(await res.text());
    } catch {
      /* header-only fallback */
    }
  }

  const signals = [...headerSignals, ...extracted.signals];
  const best = pickBestGroundingDateSignal(signals);
  if (!best) {
    return {
      ok: false,
      message:
        "Kein Datum auf der Seite gefunden (weder lastReviewed, dateModified, Prüfhinweis, Meta noch Last-Modified). Bitte manuell setzen.",
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
    facts: deriveGroundingPageLiveFacts(extracted, headerSignals),
  };
}
