import "server-only";

import {
  countCrawlViewerPages,
  filterCrawlViewerPages,
  mergeCrawlAndGscPages,
  type CrawlIndexFilter,
  type CrawlViewerPage,
  type GscPageRow,
  type InspectionSlice,
} from "@/lib/dt/seo/gsc-pages";
import { createServiceClient } from "@/lib/supabase/service";

type SitePageRow = {
  url: string;
  title: string | null;
  h1: string | null;
  meta_description: string | null;
  is_excluded: boolean;
  crawled_at: string;
};

async function fetchAllRows<T>(
  loadPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 1000,
  max = 20_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const chunk = await loadPage(from, from + pageSize - 1);
    out.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return out;
}

export async function loadCrawlViewerSnapshot(input: {
  organisationId: string;
  origin?: string | null;
  q?: string;
  index?: CrawlIndexFilter;
  offset: number;
  limit: number;
}): Promise<{
  pages: CrawlViewerPage[];
  total: number;
  counts: ReturnType<typeof countCrawlViewerPages>;
  gscSynced: boolean;
  gscFetchedAt: string | null;
}> {
  const supabase = createServiceClient();

  const [crawled, gscPages, inspections] = await Promise.all([
    fetchAllRows<SitePageRow>(async (from, to) => {
      const { data, error } = await supabase
        .from("dt_site_pages")
        .select("url,title,h1,meta_description,is_excluded,crawled_at")
        .eq("organisation_id", input.organisationId)
        .order("url", { ascending: true })
        .range(from, to);
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) return [];
        throw new Error(error.message);
      }
      return (data ?? []) as SitePageRow[];
    }),
    fetchAllRows<GscPageRow>(async (from, to) => {
      const { data, error } = await supabase
        .from("dt_seo_gsc_pages")
        .select("url,clicks,impressions,ctr,position,fetched_at,period_start,period_end")
        .eq("organisation_id", input.organisationId)
        .order("url", { ascending: true })
        .range(from, to);
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) return [];
        throw new Error(error.message);
      }
      return (data ?? []) as GscPageRow[];
    }),
    fetchAllRows<InspectionSlice>(async (from, to) => {
      const { data, error } = await supabase
        .from("dt_seo_url_index_status")
        .select("url,verdict,coverage_state,indexing_state,inspected_at")
        .eq("organisation_id", input.organisationId)
        .order("inspected_at", { ascending: false })
        .range(from, to);
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) return [];
        throw new Error(error.message);
      }
      return (data ?? []) as InspectionSlice[];
    }),
  ]);

  const gscFetchedAt = gscPages.reduce<string | null>((latest, row) => {
    if (!latest || row.fetched_at > latest) return row.fetched_at;
    return latest;
  }, null);

  const merged = mergeCrawlAndGscPages({
    crawled,
    gscPages,
    inspections,
    gscSynced: gscPages.length > 0,
    origin: input.origin,
  });
  const filtered = filterCrawlViewerPages(merged, { q: input.q, index: input.index });
  const counts = countCrawlViewerPages(merged);
  const pages = filtered.slice(input.offset, input.offset + input.limit);

  return {
    pages,
    total: filtered.length,
    counts,
    gscSynced: gscPages.length > 0,
    gscFetchedAt,
  };
}
