"use client";

import { useCallback, useEffect, useState } from "react";

import { DtSeoPageErrorsPanel } from "@/components/dt/seo/dt-seo-page-errors-panel";
import {
  evaluateSeoPageHealth,
  type SeoPageHealth,
  type SeoPageHealthIssue,
} from "@/lib/dt/seo/page-health";

type OrgConfigSlice = {
  organisation_slug?: string | null;
  website_url?: string | null;
  sitemap_url?: string | null;
  ga4_property_id?: string | null;
  ga4_account?: string | null;
  gsc_site_url?: string | null;
  gsc_account?: string | null;
};

type CrawlSlice = {
  count?: number;
  crawl?: { status?: string; message?: string | null } | null;
  lastCrawlError?: string | null;
};

type ReportSlice = {
  state?: string | null;
  state_message?: string | null;
};

/**
 * Loads live SEO config/crawl/report signals and shows a page-level error panel.
 */
export function DtSeoPageHealth(props: {
  organisationId: string;
  onFix?: (hint: NonNullable<SeoPageHealthIssue["fixHint"]>) => void;
  /** Re-fetch when this changes (e.g. after save on settings). */
  refreshKey?: number | string;
  className?: string;
}) {
  const [health, setHealth] = useState<SeoPageHealth | null>(null);

  const load = useCallback(async () => {
    try {
      const [configRes, crawlRes, reportsRes] = await Promise.all([
        fetch(`/api/dt/org-config/${props.organisationId}`),
        fetch(`/api/dt/seo/crawl?org=${encodeURIComponent(props.organisationId)}`),
        fetch(`/api/dt/seo/reports?org=${encodeURIComponent(props.organisationId)}`),
      ]);

      const configJson = (await configRes.json()) as {
        ok?: boolean;
        config?: OrgConfigSlice;
      };
      const crawlJson = (await crawlRes.json()) as CrawlSlice & { ok?: boolean };
      const reportsJson = (await reportsRes.json()) as {
        ok?: boolean;
        reports?: ReportSlice[];
      };

      const config = configJson.config;
      const failedReport = (reportsJson.reports ?? []).find(
        (r) => r.state === "error" || r.state === "cancelled",
      );

      setHealth(
        evaluateSeoPageHealth({
          organisationSlug: config?.organisation_slug,
          websiteUrl: config?.website_url,
          sitemapUrl: config?.sitemap_url,
          ga4PropertyId: config?.ga4_property_id,
          ga4Account: config?.ga4_account,
          gscSiteUrl: config?.gsc_site_url,
          gscAccount: config?.gsc_account,
          crawlStatus: crawlJson.crawl?.status ?? null,
          crawlMessage: crawlJson.crawl?.message ?? null,
          lastCrawlError: crawlJson.lastCrawlError ?? null,
          crawledPageCount: crawlJson.count ?? 0,
          lastReportState: failedReport?.state ?? null,
          lastReportMessage: failedReport?.state_message ?? null,
        }),
      );
    } catch {
      setHealth(null);
    }
  }, [props.organisationId]);

  useEffect(() => {
    void load();
  }, [load, props.refreshKey]);

  // Poll lightly while a crawl might be active / errors can clear.
  useEffect(() => {
    const id = window.setInterval(() => {
      void load();
    }, 12_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (!health) return null;

  return (
    <DtSeoPageErrorsPanel
      health={health}
      onFix={props.onFix}
      className={props.className}
    />
  );
}
