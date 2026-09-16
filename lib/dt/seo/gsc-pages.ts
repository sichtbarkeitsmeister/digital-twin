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
  gscClicks: number | null;
  gscImpressions: number | null;
  gscPosition: number | null;
  inspectionCoverage: string | null;
  inspectionVerdict: string | null;
};

export type CrawlIndexFilter = "all" | "indexed" | "not_indexed" | "unknown" | "gsc_only";

const INDEXED_COVERAGE =
  /submitted and indexed|indexed, not submitted|indexed, though blocked/i;
const NOT_INDEXED_COVERAGE =
  /currently not indexed|unknown to google|excluded|not found|soft 404|blocked by robots|page with redirect|alternate page|duplicate/i;

export function derivePageIndexStatus(input: {
  gscSynced: boolean;
  inGsc: boolean;
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

  if (input.inGsc) return "indexed";
  if (input.gscSynced) return "not_indexed";
  return "unknown";
}

export function indexStatusLabel(status: PageIndexStatus): string {
  if (status === "indexed") return "Indexiert";
  if (status === "not_indexed") return "Nicht indexiert";
  return "Unbekannt";
}

type CrawlPageInput = {
  url: string;
  title: string | null;
  h1: string | null;
  meta_description: string | null;
  is_excluded: boolean;
  crawled_at: string;
};

function lookupByUrlOrKey<T extends { url: string }>(
  exact: Map<string, T>,
  byKey: Map<string, T>,
  url: string,
): T | undefined {
  const normalised = normaliseUrl(url) ?? url;
  const hit = exact.get(normalised) ?? exact.get(url);
  if (hit) return hit;
  const key = pageComparisonKey(url);
  return key ? byKey.get(key) : undefined;
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
    const key = pageComparisonKey(row.url);
    if (key && !byKey.has(key)) byKey.set(key, row);
  }
  return { exact, byKey };
}

/**
 * Merge crawled pages with GSC performance rows and URL-Inspection samples.
 * GSC-only URLs (known to Google, missing from the crawl) are appended.
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
  const crawledKeys = new Set<string>();
  const merged: CrawlViewerPage[] = [];

  for (const page of input.crawled) {
    const key = pageComparisonKey(page.url);
    if (key) crawledKeys.add(key);
    crawledKeys.add(normaliseUrl(page.url) ?? page.url);

    const gscRow = lookupByUrlOrKey(gsc.exact, gsc.byKey, page.url);
    const inspection = lookupByUrlOrKey(inspections.exact, inspections.byKey, page.url);
    const inGsc = Boolean(gscRow);
    merged.push({
      url: page.url,
      title: page.title,
      h1: page.h1,
      meta_description: page.meta_description,
      is_excluded: page.is_excluded,
      crawled_at: page.crawled_at,
      inCrawl: true,
      inGsc,
      indexStatus: derivePageIndexStatus({
        gscSynced: input.gscSynced,
        inGsc,
        inspectionCoverage: inspection?.coverage_state,
        inspectionVerdict: inspection?.verdict,
      }),
      gscClicks: gscRow?.clicks ?? null,
      gscImpressions: gscRow?.impressions ?? null,
      gscPosition: gscRow?.position ?? null,
      inspectionCoverage: inspection?.coverage_state ?? null,
      inspectionVerdict: inspection?.verdict ?? null,
    });
  }

  for (const gscRow of input.gscPages) {
    const normalised = normaliseUrl(gscRow.url) ?? gscRow.url;
    const key = pageComparisonKey(gscRow.url);
    if (crawledKeys.has(normalised) || (key && crawledKeys.has(key))) continue;
    if (input.origin && !isSameCrawlSite(gscRow.url, input.origin)) continue;

    const inspection = lookupByUrlOrKey(inspections.exact, inspections.byKey, gscRow.url);
    merged.push({
      url: normalised,
      title: null,
      h1: null,
      meta_description: null,
      is_excluded: false,
      crawled_at: null,
      inCrawl: false,
      inGsc: true,
      indexStatus: derivePageIndexStatus({
        gscSynced: true,
        inGsc: true,
        inspectionCoverage: inspection?.coverage_state,
        inspectionVerdict: inspection?.verdict,
      }),
      gscClicks: gscRow.clicks,
      gscImpressions: gscRow.impressions,
      gscPosition: gscRow.position,
      inspectionCoverage: inspection?.coverage_state ?? null,
      inspectionVerdict: inspection?.verdict ?? null,
    });
  }

  merged.sort((a, b) => a.url.localeCompare(b.url));
  return merged;
}

export function filterCrawlViewerPages(
  pages: CrawlViewerPage[],
  opts: { q?: string; index?: CrawlIndexFilter },
): CrawlViewerPage[] {
  const needle = opts.q?.trim().toLowerCase() ?? "";
  const index = opts.index ?? "all";
  return pages.filter((page) => {
    if (index === "indexed" && page.indexStatus !== "indexed") return false;
    if (index === "not_indexed" && page.indexStatus !== "not_indexed") return false;
    if (index === "unknown" && page.indexStatus !== "unknown") return false;
    if (index === "gsc_only" && !(page.inGsc && !page.inCrawl)) return false;
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
} {
  let crawled = 0;
  let gsc = 0;
  let gscOnly = 0;
  let indexed = 0;
  let notIndexed = 0;
  let unknown = 0;
  for (const page of pages) {
    if (page.inCrawl) crawled += 1;
    if (page.inGsc) gsc += 1;
    if (page.inGsc && !page.inCrawl) gscOnly += 1;
    if (page.indexStatus === "indexed") indexed += 1;
    else if (page.indexStatus === "not_indexed") notIndexed += 1;
    else unknown += 1;
  }
  return {
    total: pages.length,
    crawled,
    gsc,
    gscOnly,
    indexed,
    notIndexed,
    unknown,
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
