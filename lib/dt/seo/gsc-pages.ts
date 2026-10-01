import { pageComparisonKey } from "@/lib/dt/seo/indexability-audit";
import { isSameCrawlSite, normaliseUrl } from "@/lib/dt/seo/crawl-url";

export const GSC_PAGES_MAX_INGEST = 25_000;
export const GSC_SYNC_WAIT_MS = 8 * 60 * 1000;

export type PageIndexStatus = "indexed" | "not_indexed" | "unknown";

export type GscPageRow = {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  fetched_at: string;
  period_start: string | null;
  period_end: string | null;
};

export type InspectionSlice = {
  url: string;
  verdict: string | null;
  coverage_state: string | null;
  indexing_state: string | null;
  inspected_at: string;
};

export type CrawlViewerPage = {
  url: string;
  title: string | null;
  h1: string | null;
  meta_description: string | null;
  is_excluded: boolean;
  crawled_at: string | null;
  inCrawl: boolean;
  inGsc: boolean;
  indexStatus: PageIndexStatus;
  /** Human-readable GSC-style reason when not indexed. */
  indexReason: string | null;
  /** True when the page is a redirect / www-http variant (GSC: Seite mit Weiterleitung). */
  isRedirect: boolean;
  redirectTarget: string | null;
  gscClicks: number | null;
  gscImpressions: number | null;
  gscPosition: number | null;
  inspectionCoverage: string | null;
  inspectionVerdict: string | null;
};

export type CrawlIndexFilter = "all" | "indexed" | "not_indexed" | "unknown" | "gsc_only" | "redirect";

const INDEXED_COVERAGE =
  /submitted and indexed|indexed, not submitted|indexed, though blocked/i;
const NOT_INDEXED_COVERAGE =
  /currently not indexed|unknown to google|excluded|not found|soft 404|blocked by robots|page with redirect|alternate page|duplicate/i;

export function coveragePageKey(value: string): string | null {
  const key = pageComparisonKey(value);
  if (!key) return null;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

function urlPathname(value: string): string | null {
  try {
    const path = decodeURIComponent(new URL(value).pathname);
    return path.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

export function coverageUrlsEqual(a: string, b: string): boolean {
  return (normaliseUrl(a) ?? a) === (normaliseUrl(b) ?? b);
}

/**
 * GSC Coverage treats www/non-www, http/https and other landed URLs as
 * separate entries. The requested URL is then usually "Seite mit Weiterleitung".
 */
export function isCoverageRedirectVariant(pageUrl: string, otherUrl: string | null | undefined): boolean {
  if (!otherUrl) return false;
  return !coverageUrlsEqual(pageUrl, otherUrl);
}

const COVERAGE_LABEL_DE: Array<{ test: RegExp; label: string }> = [
  { test: /page with redirect/i, label: "Seite mit Weiterleitung" },
  { test: /crawled - currently not indexed/i, label: "Gecrawlt, derzeit nicht indexiert" },
  { test: /discovered - currently not indexed/i, label: "Gefunden, derzeit nicht indexiert" },
  { test: /alternate page|duplicate/i, label: "Alternativseite mit kanonischem Tag" },
  { test: /not found|soft 404/i, label: "Nicht gefunden (404)" },
  { test: /blocked by robots/i, label: "Durch robots.txt blockiert" },
  { test: /excluded by.?noindex/i, label: "Durch noindex ausgeschlossen" },
  { test: /unknown to google/i, label: "Google unbekannt" },
];

export function matchCoverageRow<T extends { url: string }>(
  rows: T[],
  url: string,
): { row: T; exact: boolean } | null {
  const exact = rows.find((row) => coverageUrlsEqual(row.url, url));
  if (exact) return { row: exact, exact: true };
  const key = coveragePageKey(url);
  if (!key) return null;
  const fuzzy = rows.find((row) => coveragePageKey(row.url) === key);
  return fuzzy ? { row: fuzzy, exact: false } : null;
}

export function isRedirectCoverage(coverage: string | null | undefined): boolean {
  return /page with redirect/i.test(String(coverage ?? ""));
}

export function deriveRedirectMeta(input: {
  redirected?: boolean;
  redirectTarget?: string | null;
  inspectionCoverage?: string | null;
}): { isRedirect: boolean; redirectTarget: string | null } {
  return {
    isRedirect: Boolean(input.redirected) || isRedirectCoverage(input.inspectionCoverage),
    redirectTarget: input.redirectTarget?.trim() || null,
  };
}

export function coverageStateLabel(coverage: string | null | undefined): string | null {
  const raw = String(coverage ?? "").trim();
  if (!raw) return null;
  for (const row of COVERAGE_LABEL_DE) {
    if (row.test.test(raw)) return row.label;
  }
  return raw;
}

export function derivePageIndexStatus(input: {
  gscSynced: boolean;
  inGsc: boolean;
  /** Exact Search Analytics URL (www/scheme must match). Default true when omitted. */
  gscExactMatch?: boolean;
  redirected?: boolean;
  inspectionCoverage?: string | null;
  inspectionVerdict?: string | null;
}): PageIndexStatus {
  const coverage = String(input.inspectionCoverage ?? "").trim();
  const verdict = String(input.inspectionVerdict ?? "").trim().toUpperCase();

  if (coverage || verdict) {
    if (INDEXED_COVERAGE.test(coverage) || verdict === "PASS") return "indexed";
    if (NOT_INDEXED_COVERAGE.test(coverage) || verdict === "FAIL" || verdict === "NEUTRAL") {
      return "not_indexed";
    }
    if (/indexed/i.test(coverage) && !/not indexed/i.test(coverage)) return "indexed";
    if (coverage) return "not_indexed";
  }

  if (input.redirected) return "not_indexed";
  if (input.inGsc && input.gscExactMatch === false) return "not_indexed";
  if (input.inGsc) return "indexed";
  if (input.gscSynced) return "not_indexed";
  return "unknown";
}

export function deriveIndexReason(input: {
  status: PageIndexStatus;
  inspectionCoverage?: string | null;
  redirected?: boolean;
  redirectTarget?: string | null;
  gscExactMatch?: boolean;
  inGsc?: boolean;
  inCrawl?: boolean;
}): string | null {
  if (input.status !== "not_indexed") return null;
  const fromInspection = coverageStateLabel(input.inspectionCoverage);
  if (fromInspection) {
    if (fromInspection === "Seite mit Weiterleitung" && input.redirectTarget) {
      return `Seite mit Weiterleitung → ${input.redirectTarget}`;
    }
    return fromInspection;
  }
  if (input.redirected || (input.inGsc && input.gscExactMatch === false)) {
    return input.redirectTarget
      ? `Seite mit Weiterleitung → ${input.redirectTarget}`
      : "Seite mit Weiterleitung";
  }
  if (input.inCrawl === false) return "Gefunden – derzeit nicht indexiert";
  return "Gecrawlt – derzeit nicht indexiert";
}

export function indexStatusLabel(status: PageIndexStatus): string {
  if (status === "indexed") return "Indexiert";
  if (status === "not_indexed") return "Nicht indexiert";
  return "Unbekannt";
}

function csvCell(value: string | number | boolean | null | undefined): string {
  const raw =
    value === null || value === undefined ? "" : typeof value === "number" ? String(value) : String(value);
  if (/[;"\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

/** Semicolon CSV for Excel (DE), including index status and GSC metrics. */
export function crawlPagesToCsv(pages: CrawlViewerPage[]): string {
  const header = [
    "URL",
    "Titel",
    "H1",
    "Meta-Description",
    "Indexstatus",
    "Indexgrund",
    "Weiterleitung",
    "Weiterleitung-Ziel",
    "Im Crawl",
    "In Leistungsdaten",
    "Impressionen",
    "Klicks",
    "Position",
    "Inspection",
    "Inspection-Verdict",
    "Ausgeschlossen",
    "Gecrawlt am",
  ];
  const lines = pages.map((page) =>
    [
      csvCell(page.url),
      csvCell(page.title),
      csvCell(page.h1),
      csvCell(page.meta_description),
      csvCell(indexStatusLabel(page.indexStatus)),
      csvCell(page.indexReason),
      csvCell(page.isRedirect ? "ja" : "nein"),
      csvCell(page.redirectTarget),
      csvCell(page.inCrawl ? "ja" : "nein"),
      csvCell(page.inGsc ? "ja" : "nein"),
      csvCell(page.gscImpressions),
      csvCell(page.gscClicks),
      csvCell(page.gscPosition),
      csvCell(page.inspectionCoverage),
      csvCell(page.inspectionVerdict),
      csvCell(page.is_excluded ? "ja" : "nein"),
      csvCell(page.crawled_at ? new Date(page.crawled_at).toISOString() : ""),
    ].join(";"),
  );
  return `\uFEFF${[header.join(";"), ...lines].join("\r\n")}\r\n`;
}

type CrawlPageInput = {
  url: string;
  title: string | null;
  h1: string | null;
  meta_description: string | null;
  is_excluded: boolean;
  crawled_at: string;
  final_url?: string | null;
};

function lookupExact<T extends { url: string }>(exact: Map<string, T>, url: string): T | undefined {
  const normalised = normaliseUrl(url) ?? url;
  return exact.get(normalised) ?? exact.get(url);
}

function lookupByUrlOrKey<T extends { url: string }>(
  exact: Map<string, T>,
  byKey: Map<string, T>,
  url: string,
): T | undefined {
  const hit = lookupExact(exact, url);
  if (hit) return hit;
  const key = coveragePageKey(url);
  return key ? byKey.get(key) : undefined;
}

function toViewerPage(input: {
  url: string;
  title: string | null;
  h1: string | null;
  meta_description: string | null;
  is_excluded: boolean;
  crawled_at: string | null;
  inCrawl: boolean;
  gscSynced: boolean;
  gscRow?: GscPageRow | null;
  gscExactMatch: boolean;
  redirected: boolean;
  redirectTarget: string | null;
  inspection?: InspectionSlice | null;
}): CrawlViewerPage {
  const inGsc = Boolean(input.gscRow) && input.gscExactMatch && !input.redirected;
  const indexStatus = derivePageIndexStatus({
    gscSynced: input.gscSynced,
    inGsc,
    gscExactMatch: input.gscExactMatch,
    redirected: input.redirected,
    inspectionCoverage: input.inspection?.coverage_state,
    inspectionVerdict: input.inspection?.verdict,
  });
  return {
    url: input.url,
    title: input.title,
    h1: input.h1,
    meta_description: input.meta_description,
    is_excluded: input.is_excluded,
    crawled_at: input.crawled_at,
    inCrawl: input.inCrawl,
    inGsc,
    indexStatus,
    indexReason: deriveIndexReason({
      status: indexStatus,
      inspectionCoverage: input.inspection?.coverage_state,
      redirected: input.redirected,
      redirectTarget: input.redirectTarget,
      gscExactMatch: input.gscExactMatch,
      inGsc,
      inCrawl: input.inCrawl,
    }),
    ...deriveRedirectMeta({
      redirected: input.redirected,
      redirectTarget: input.redirectTarget,
      inspectionCoverage: input.inspection?.coverage_state,
    }),
    gscClicks: input.redirected || !input.gscExactMatch ? null : (input.gscRow?.clicks ?? null),
    gscImpressions: input.redirected || !input.gscExactMatch ? null : (input.gscRow?.impressions ?? null),
    gscPosition: input.redirected || !input.gscExactMatch ? null : (input.gscRow?.position ?? null),
    inspectionCoverage: input.inspection?.coverage_state ?? null,
    inspectionVerdict: input.inspection?.verdict ?? null,
  };
}

function buildLookups<T extends { url: string }>(rows: T[]): {
  exact: Map<string, T>;
  byKey: Map<string, T>;
} {
  const exact = new Map<string, T>();
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const normalised = normaliseUrl(row.url) ?? row.url;
    if (!exact.has(normalised)) exact.set(normalised, row);
    const key = coveragePageKey(row.url);
    if (key && !byKey.has(key)) byKey.set(key, row);
  }
  return { exact, byKey };
}

/**
 * Merge crawled pages with GSC performance rows and URL-Inspection samples.
 * GSC-only URLs (known to Google, missing from the crawl) are appended.
 * www/http variants are kept as separate URLs: only an exact GSC URL counts as indexed.
 */
export function mergeCrawlAndGscPages(input: {
  crawled: CrawlPageInput[];
  gscPages: GscPageRow[];
  inspections?: InspectionSlice[];
  gscSynced: boolean;
  origin?: string | null;
}): CrawlViewerPage[] {
  const gsc = buildLookups(input.gscPages);
  const inspections = buildLookups(input.inspections ?? []);
  const crawledExact = new Set<string>();
  const merged: CrawlViewerPage[] = [];

  for (const page of input.crawled) {
    crawledExact.add(normaliseUrl(page.url) ?? page.url);
    crawledExact.add(page.url);

    const gscExact = lookupExact(gsc.exact, page.url);
    const gscRow = gscExact ?? lookupByUrlOrKey(gsc.exact, gsc.byKey, page.url);
    const gscExactMatch = Boolean(gscExact);
    const inspection = lookupByUrlOrKey(inspections.exact, inspections.byKey, page.url);
    const redirected = isCoverageRedirectVariant(page.url, page.final_url);
    const redirectTarget =
      (redirected ? page.final_url : null) ||
      (!gscExactMatch && gscRow ? gscRow.url : null);

    merged.push(
      toViewerPage({
        url: page.url,
        title: page.title,
        h1: page.h1,
        meta_description: page.meta_description,
        is_excluded: page.is_excluded,
        crawled_at: page.crawled_at,
        inCrawl: true,
        gscSynced: input.gscSynced,
        gscRow,
        gscExactMatch,
        redirected: redirected || Boolean(!gscExactMatch && gscRow),
        redirectTarget,
        inspection,
      }),
    );
  }

  for (const gscRow of input.gscPages) {
    const normalised = normaliseUrl(gscRow.url) ?? gscRow.url;
    if (crawledExact.has(normalised) || crawledExact.has(gscRow.url)) continue;
    if (input.origin && !isSameCrawlSite(gscRow.url, input.origin)) continue;

    const inspection = lookupByUrlOrKey(inspections.exact, inspections.byKey, gscRow.url);
    merged.push(
      toViewerPage({
        url: normalised,
        title: null,
        h1: null,
        meta_description: null,
        is_excluded: false,
        crawled_at: null,
        inCrawl: false,
        gscSynced: true,
        gscRow,
        gscExactMatch: true,
        redirected: false,
        redirectTarget: null,
        inspection,
      }),
    );
  }

  merged.sort((a, b) => a.url.localeCompare(b.url));
  return applyGscCoverageHeuristics(merged);
}

function titlesMatch(a: CrawlViewerPage, b: CrawlViewerPage): boolean {
  const title = a.title?.trim();
  if (!title) return false;
  return title === b.title?.trim();
}

function markAsRedirect(page: CrawlViewerPage, target: string): CrawlViewerPage {
  const reason = `Seite mit Weiterleitung → ${target}`;
  return {
    ...page,
    indexStatus: "not_indexed",
    isRedirect: true,
    redirectTarget: target,
    indexReason: reason,
    inGsc: false,
    gscClicks: null,
    gscImpressions: null,
    gscPosition: null,
  };
}

/**
 * Bring leftover crawl artefacts in line with GSC Coverage:
 * http/www/encoding clusters keep one indexed URL; the others are
 * "Seite mit Weiterleitung". Destination HTML stored under an old URL
 * (same title as the homepage) is treated the same way.
 */
export function applyGscCoverageHeuristics(pages: CrawlViewerPage[]): CrawlViewerPage[] {
  const byKey = new Map<string, CrawlViewerPage[]>();
  for (const page of pages) {
    const key = coveragePageKey(page.url);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(page);
    byKey.set(key, list);
  }

  const httpsHome = pages.find((page) => urlPathname(page.url) === "/" && page.url.startsWith("https:"));
  const anyHome = pages.find((page) => urlPathname(page.url) === "/");
  const home = httpsHome ?? anyHome ?? null;

  return pages.map((page) => {
    let next = page.isRedirect
      ? {
          ...page,
          inGsc: false,
          gscClicks: null,
          gscImpressions: null,
          gscPosition: null,
        }
      : page;

    const key = coveragePageKey(page.url);
    const cluster = key ? byKey.get(key) : undefined;
    if (cluster && cluster.length > 1) {
      const canonical =
        cluster.find((item) => item.indexStatus === "indexed" && item.url.startsWith("https:")) ??
        cluster.find((item) => item.indexStatus === "indexed") ??
        cluster.find((item) => item.url.startsWith("https:")) ??
        cluster[0];
      if (canonical && canonical.url !== page.url) {
        next = markAsRedirect(next, canonical.url);
      }
    }

    if (
      !next.isRedirect &&
      home &&
      urlPathname(page.url) !== "/" &&
      titlesMatch(page, home)
    ) {
      next = markAsRedirect(next, home.url);
    }

    return next;
  });
}

export function indexReasonGroup(page: Pick<CrawlViewerPage, "isRedirect" | "indexReason">): string | null {
  if (page.isRedirect) return "Seite mit Weiterleitung";
  const reason = page.indexReason?.trim();
  if (!reason) return null;
  return reason.split(" → ")[0] ?? reason;
}

export function filterCrawlViewerPages(
  pages: CrawlViewerPage[],
  opts: { q?: string; index?: CrawlIndexFilter; reason?: string },
): CrawlViewerPage[] {
  const needle = opts.q?.trim().toLowerCase() ?? "";
  const index = opts.index ?? "all";
  const reason = opts.reason?.trim() ?? "";
  return pages.filter((page) => {
    if (index === "indexed" && page.indexStatus !== "indexed") return false;
    if (index === "not_indexed" && page.indexStatus !== "not_indexed") return false;
    if (index === "unknown" && page.indexStatus !== "unknown") return false;
    if (index === "gsc_only" && !(page.inGsc && !page.inCrawl)) return false;
    if (index === "redirect" && !page.isRedirect) return false;
    if (reason && indexReasonGroup(page) !== reason) return false;
    if (!needle) return true;
    const hay = [page.url, page.title, page.h1, page.meta_description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
}

export function countCrawlViewerPages(pages: CrawlViewerPage[]): {
  total: number;
  crawled: number;
  gsc: number;
  gscOnly: number;
  indexed: number;
  notIndexed: number;
  unknown: number;
  redirects: number;
  notIndexedReasons: Array<{ reason: string; count: number }>;
} {
  let crawled = 0;
  let gsc = 0;
  let gscOnly = 0;
  let indexed = 0;
  let notIndexed = 0;
  let unknown = 0;
  let redirects = 0;
  const reasonCounts = new Map<string, number>();
  for (const page of pages) {
    if (page.inCrawl) crawled += 1;
    if (page.inGsc) gsc += 1;
    if (page.inGsc && !page.inCrawl) gscOnly += 1;
    if (page.isRedirect) redirects += 1;
    if (page.indexStatus === "indexed") indexed += 1;
    else if (page.indexStatus === "not_indexed") {
      notIndexed += 1;
      const group = indexReasonGroup(page);
      if (group) reasonCounts.set(group, (reasonCounts.get(group) ?? 0) + 1);
    } else unknown += 1;
  }
  return {
    total: pages.length,
    crawled,
    gsc,
    gscOnly,
    indexed,
    notIndexed,
    unknown,
    redirects,
    notIndexedReasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };
}

export function gscSyncIsFresh(fetchedAt: string | null | undefined, now = Date.now()): boolean {
  if (!fetchedAt) return false;
  const ts = new Date(fetchedAt).getTime();
  if (Number.isNaN(ts)) return false;
  return now - ts < 12 * 60 * 60 * 1000;
}

export function shouldWaitForGscSync(input: {
  status: string | null | undefined;
  startedAt: string | null | undefined;
  now?: number;
}): boolean {
  if (input.status !== "pending") return false;
  const now = input.now ?? Date.now();
  if (!input.startedAt) return true;
  const started = new Date(input.startedAt).getTime();
  if (Number.isNaN(started)) return true;
  return now - started < GSC_SYNC_WAIT_MS;
}

export function mapGscAnalyticsRows(
  rows: Array<{
    keys?: string[];
    clicks?: number;
    impressions?: number;
    ctr?: number | null;
    position?: number | null;
  }>,
  origin?: string | null,
): Array<{ url: string; clicks: number; impressions: number; ctr: number | null; position: number | null }> {
  const out: Array<{
    url: string;
    clicks: number;
    impressions: number;
    ctr: number | null;
    position: number | null;
  }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const raw = String(row.keys?.[0] ?? "").trim();
    const url = normaliseUrl(raw);
    if (!url || seen.has(url)) continue;
    if (origin && !isSameCrawlSite(url, origin)) continue;
    seen.add(url);
    out.push({
      url,
      clicks: Number(row.clicks ?? 0) || 0,
      impressions: Number(row.impressions ?? 0) || 0,
      ctr: typeof row.ctr === "number" ? row.ctr : null,
      position: typeof row.position === "number" ? row.position : null,
    });
  }
  return out;
}
