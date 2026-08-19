/**
 * Aggregated SEO page health: crawl, GA/GSC linking, config readiness.
 * Pure helper — UI loads live data and calls this to show fixable issues.
 */

import {
  evaluateSeoReportReadiness,
  type SeoReportReadinessIssue,
} from "@/lib/dt/seo/report-readiness";

export type SeoPageHealthLevel = "error" | "warning";

export type SeoPageHealthIssue = {
  code: string;
  level: SeoPageHealthLevel;
  area: "config" | "crawl" | "ga4" | "gsc" | "report";
  message: string;
  /** Optional deep-link hint for the UI (settings tab / crawl / reports). */
  fixHint?: "settings" | "crawl" | "reports";
};

export type SeoPageHealthInput = {
  organisationSlug?: string | null;
  websiteUrl?: string | null;
  sitemapUrl?: string | null;
  ga4PropertyId?: string | null;
  ga4Account?: string | null;
  gscSiteUrl?: string | null;
  gscAccount?: string | null;
  /** Active or last crawl status. */
  crawlStatus?: string | null;
  crawlMessage?: string | null;
  lastCrawlError?: string | null;
  crawledPageCount?: number | null;
  /** Latest SEO report in error state (optional). */
  lastReportState?: string | null;
  lastReportMessage?: string | null;
};

export type SeoPageHealth = {
  /** True when there are no error-level issues (warnings may remain). */
  ok: boolean;
  /** True when there is nothing to fix at all. */
  clean: boolean;
  errors: SeoPageHealthIssue[];
  warnings: SeoPageHealthIssue[];
  issues: SeoPageHealthIssue[];
};

function mapReadiness(issue: SeoReportReadinessIssue): SeoPageHealthIssue {
  const area: SeoPageHealthIssue["area"] =
    issue.code === "missing_ga4_account"
      ? "ga4"
      : issue.code === "missing_gsc_account"
        ? "gsc"
        : "config";
  return {
    code: issue.code,
    level: issue.level === "blocker" ? "error" : "warning",
    area,
    message: issue.message,
    fixHint: "settings",
  };
}

/**
 * Collect all visible SEO problems for the current organisation page.
 */
export function evaluateSeoPageHealth(input: SeoPageHealthInput): SeoPageHealth {
  const issues: SeoPageHealthIssue[] = [];

  const readiness = evaluateSeoReportReadiness({
    organisationSlug: input.organisationSlug,
    websiteUrl: input.websiteUrl,
    ga4Account: input.ga4Account,
    gscAccount: input.gscAccount,
  });
  for (const issue of readiness.issues) {
    issues.push(mapReadiness(issue));
  }

  const website = String(input.websiteUrl ?? "").trim();
  const ga4Property = String(input.ga4PropertyId ?? "").trim();
  const gscSite = String(input.gscSiteUrl ?? "").trim();

  if (website && !ga4Property) {
    issues.push({
      code: "missing_ga4_property",
      level: "warning",
      area: "ga4",
      message:
        "GA4 Property-ID fehlt — ohne sie können Analytics-Daten in Reports nicht verknüpft werden.",
      fixHint: "settings",
    });
  }

  if (website && !gscSite) {
    issues.push({
      code: "missing_gsc_site_url",
      level: "warning",
      area: "gsc",
      message:
        "GSC Property-URL fehlt — ohne sie können Search-Console-Daten nicht verknüpft werden.",
      fixHint: "settings",
    });
  }

  const crawlStatus = String(input.crawlStatus ?? "").trim().toLowerCase();
  const lastCrawlError = String(input.lastCrawlError ?? "").trim();
  const crawlMessage = String(input.crawlMessage ?? "").trim();

  if (crawlStatus === "error" || lastCrawlError) {
    const detail =
      (crawlStatus === "error" ? crawlMessage : "") ||
      lastCrawlError ||
      "Crawl fehlgeschlagen.";
    issues.push({
      code: "crawl_error",
      level: "error",
      area: "crawl",
      message: `Crawl-Fehler: ${detail}`,
      fixHint: "crawl",
    });
  }

  const pageCount = input.crawledPageCount ?? 0;
  if (website && pageCount === 0 && crawlStatus !== "queued" && crawlStatus !== "running") {
    issues.push({
      code: "crawl_empty",
      level: "warning",
      area: "crawl",
      message:
        "Noch keine Crawl-Seiten gespeichert — Website crawlen, damit Prefill und SEO-Kontext greifen.",
      fixHint: "crawl",
    });
  }

  const reportState = String(input.lastReportState ?? "").trim().toLowerCase();
  if (reportState === "error" || reportState === "cancelled") {
    const detail = String(input.lastReportMessage ?? "").trim();
    issues.push({
      code: "report_error",
      level: reportState === "error" ? "error" : "warning",
      area: "report",
      message: detail
        ? `Letzter SEO-Report: ${detail}`
        : reportState === "error"
          ? "Letzter SEO-Report ist fehlgeschlagen."
          : "Letzter SEO-Report wurde abgebrochen.",
      fixHint: "reports",
    });
  }

  // Dedupe by code (first wins)
  const seen = new Set<string>();
  const unique = issues.filter((i) => {
    if (seen.has(i.code)) return false;
    seen.add(i.code);
    return true;
  });

  const errors = unique.filter((i) => i.level === "error");
  const warnings = unique.filter((i) => i.level === "warning");

  return {
    ok: errors.length === 0,
    clean: unique.length === 0,
    errors,
    warnings,
    issues: unique,
  };
}

export function seoPageHealthHasIssues(health: SeoPageHealth): boolean {
  return health.issues.length > 0;
}
