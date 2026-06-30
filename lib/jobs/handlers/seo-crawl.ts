import {
  expandSitemapSeeds,
  fetchAndParse,
  normaliseUrl,
  resolveOrigin,
  toCrawledPage,
  type DtCrawledPage,
} from "@/lib/dt/seo/crawl-sitemap";
import { enqueueJob } from "@/lib/jobs/queue";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";
import { createServiceClient } from "@/lib/supabase/service";

import type { JobHandler } from "../types";

type OrgConfigSlice = {
  website_url: string | null;
  sitemap_url: string | null;
};

async function loadOrgConfigForCrawl(
  supabase: ReturnType<typeof createServiceClient>,
  organisationId: string,
): Promise<OrgConfigSlice | null> {
  const { data } = await supabase
    .from("dt_org_config")
    .select("website_url,sitemap_url")
    .eq("organisation_id", organisationId)
    .maybeSingle();
  return data as OrgConfigSlice | null;
}

const CHUNK_SIZE = 25;
const FETCH_CONCURRENCY = 8;

type CrawlRow = {
  id: string;
  organisation_id: string;
  status: string;
  max_pages: number;
  pages_crawled: number;
  pages_discovered: number;
  message: string | null;
};

type ClaimedUrl = { id: string; url: string; depth: number };

/**
 * Resumable background website crawl (kind: seo.crawl).
 * Payload: { crawlId: uuid, organisationId: uuid }
 */
export const seoCrawlHandler: JobHandler = async ({ job }) => {
  const payload = job.payload as { crawlId?: string; organisationId?: string };
  const crawlId = payload.crawlId;
  const organisationId = payload.organisationId ?? job.organisation_id;

  if (!crawlId || !organisationId) {
    return { ok: false, error: "Missing crawlId or organisationId", retryable: false };
  }

  const supabase = createServiceClient();

  const { data: crawl, error: crawlError } = await supabase
    .from("dt_site_crawls")
    .select("id,organisation_id,status,max_pages,pages_crawled,pages_discovered,message")
    .eq("id", crawlId)
    .maybeSingle();

  if (crawlError) {
    return { ok: false, error: `Crawl lookup failed: ${crawlError.message}` };
  }
  if (!crawl) {
    return { ok: false, error: "Crawl not found", retryable: false };
  }

  const row = crawl as CrawlRow;

  if (row.status === "cancelled" || row.status === "done" || row.status === "error") {
    return { ok: true, result: { skipped: row.status } };
  }

  if (row.status === "queued") {
    const seeded = await seedFrontier(supabase, row);
    if (!seeded.ok) {
      await markCrawlError(supabase, crawlId, seeded.error);
      return { ok: false, error: seeded.error, retryable: false };
    }
    await supabase
      .from("dt_site_crawls")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        message: seeded.message,
        pages_discovered: seeded.pagesDiscovered,
      })
      .eq("id", crawlId);
  }

  const { data: freshCrawl } = await supabase
    .from("dt_site_crawls")
    .select("status,max_pages,pages_crawled,pages_discovered")
    .eq("id", crawlId)
    .maybeSingle();

  if (!freshCrawl || freshCrawl.status === "cancelled") {
    return { ok: true, result: { skipped: "cancelled" } };
  }

  const { data: claimed, error: claimError } = await supabase.rpc("dt_claim_crawl_urls", {
    p_crawl_id: crawlId,
    p_limit: CHUNK_SIZE,
  });

  if (claimError) {
    return { ok: false, error: `Claim failed: ${claimError.message}` };
  }

  const urls = (claimed ?? []) as ClaimedUrl[];

  if (urls.length === 0) {
    const done = await finishIfEmpty(supabase, crawlId);
    return { ok: true, result: done };
  }

  const config = await loadOrgConfigForCrawl(supabase, organisationId);
  const origin =
    resolveOrigin(config?.website_url) ??
    (() => {
      try {
        return new URL(urls[0]!.url).origin;
      } catch {
        return null;
      }
    })();

  if (!origin) {
    await markCrawlError(supabase, crawlId, "Keine Website-URL konfiguriert.");
    return { ok: false, error: "No origin", retryable: false };
  }

  const crawledRows: DtCrawledPage[] = [];
  const newLinks: { url: string; depth: number }[] = [];

  await mapPool(urls, FETCH_CONCURRENCY, async (item) => {
    const excludedRow = toCrawledPage(item.url, origin);
    if (excludedRow) {
      crawledRows.push(excludedRow);
      return;
    }
    const { page, links } = await fetchAndParse(item.url, origin);
    crawledRows.push({ url: item.url, ...page, is_excluded: false });
    for (const link of links) {
      const n = normaliseUrl(link);
      if (n) newLinks.push({ url: n, depth: item.depth + 1 });
    }
  });

  const now = new Date().toISOString();
  if (crawledRows.length > 0) {
    const payloadRows = crawledRows.map((r) => ({
      organisation_id: organisationId,
      url: r.url,
      title: r.title,
      h1: r.h1,
      meta_description: r.meta_description,
      text_content: r.text_content,
      is_excluded: r.is_excluded,
      crawled_at: now,
    }));
    for (let i = 0; i < payloadRows.length; i += 25) {
      const { error } = await supabase
        .from("dt_site_pages")
        .upsert(payloadRows.slice(i, i + 25), { onConflict: "organisation_id,url" });
      if (error) {
        return { ok: false, error: `Upsert failed: ${error.message}` };
      }
    }
  }

  const doneIds: string[] = [];
  const errorIds: string[] = [];
  for (const item of urls) {
    const crawled = crawledRows.find((r) => r.url === item.url);
    if (crawled && !crawled.is_excluded && crawled.text_content === null && crawled.title === null) {
      errorIds.push(item.id);
    } else {
      doneIds.push(item.id);
    }
  }

  if (doneIds.length > 0) {
    await supabase.from("dt_crawl_queue").update({ status: "done" }).in("id", doneIds);
  }
  if (errorIds.length > 0) {
    await supabase.from("dt_crawl_queue").update({ status: "error" }).in("id", errorIds);
  }

  const maxPages = freshCrawl.max_pages ?? 5000;
  let pagesDiscovered = freshCrawl.pages_discovered ?? 0;

  const uniqueNew: { crawl_id: string; organisation_id: string; url: string; depth: number }[] = [];
  const seen = new Set<string>();
  for (const link of newLinks) {
    if (pagesDiscovered + uniqueNew.length >= maxPages) break;
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    uniqueNew.push({
      crawl_id: crawlId,
      organisation_id: organisationId,
      url: link.url,
      depth: link.depth,
    });
  }

  if (uniqueNew.length > 0) {
    await supabase.from("dt_crawl_queue").upsert(uniqueNew, {
      onConflict: "crawl_id,url",
      ignoreDuplicates: true,
    });
  }

  const { count: queueCount } = await supabase
    .from("dt_crawl_queue")
    .select("id", { count: "exact", head: true })
    .eq("crawl_id", crawlId);
  pagesDiscovered = queueCount ?? pagesDiscovered;

  const pagesCrawled = (freshCrawl.pages_crawled ?? 0) + urls.length;
  const active = crawledRows.filter((r) => !r.is_excluded).length;
  const withText = crawledRows.filter((r) => (r.text_content?.length ?? 0) > 0).length;

  await supabase
    .from("dt_site_crawls")
    .update({
      pages_crawled: pagesCrawled,
      pages_discovered: pagesDiscovered,
      message: `${pagesCrawled} Seiten gecrawlt (${active} in diesem Chunk prüfbar, ${withText} mit Text).`,
    })
    .eq("id", crawlId);

  const { data: after } = await supabase
    .from("dt_site_crawls")
    .select("status")
    .eq("id", crawlId)
    .maybeSingle();

  if (after?.status === "cancelled") {
    return { ok: true, result: { stopped: true, pagesCrawled } };
  }

  const hasPending = await hasPendingUrls(supabase, crawlId);
  if (!hasPending) {
    await supabase
      .from("dt_site_crawls")
      .update({
        status: "done",
        finished_at: new Date().toISOString(),
        message: `Abgeschlossen: ${pagesCrawled} Seiten gecrawlt.`,
      })
      .eq("id", crawlId);
    return { ok: true, result: { done: true, pagesCrawled } };
  }

  await enqueueJob({
    kind: "seo.crawl",
    organisationId,
    payload: { crawlId, organisationId },
    runAfter: new Date(),
  });
  kickJobsWorker(5);

  return { ok: true, result: { continued: true, pagesCrawled, chunk: urls.length } };
};

async function seedFrontier(
  supabase: ReturnType<typeof createServiceClient>,
  crawl: CrawlRow,
): Promise<
  | { ok: true; message: string; pagesDiscovered: number }
  | { ok: false; error: string }
> {
  const config = await loadOrgConfigForCrawl(supabase, crawl.organisation_id);
  if (!config) {
    return { ok: false, error: "Organisation nicht gefunden." };
  }

  const origin = resolveOrigin(config.website_url);
  if (!origin) {
    return { ok: false, error: "Keine Website-URL konfiguriert." };
  }

  const seeds = new Set<string>();
  const websiteNorm = config.website_url ? normaliseUrl(config.website_url) : null;
  if (websiteNorm) seeds.add(websiteNorm);

  let sitemapCount = 0;
  let sourceNote = "Website-Crawl (interne Links)";
  try {
    const expanded = await expandSitemapSeeds(origin, config.sitemap_url);
    sitemapCount = expanded.sitemapCount;
    for (const u of expanded.seeds) seeds.add(u);
    if (sitemapCount > 0) {
      sourceNote = `Sitemap (${sitemapCount} URLs) + interne Links`;
    }
  } catch {
    /* fall back to link crawl */
  }

  if (seeds.size === 0) {
    return { ok: false, error: "Keine Start-URLs gefunden." };
  }

  const capped = [...seeds].slice(0, crawl.max_pages);
  const rows = capped.map((url) => ({
    crawl_id: crawl.id,
    organisation_id: crawl.organisation_id,
    url,
    depth: 0,
    status: "pending",
  }));

  const { error } = await supabase.from("dt_crawl_queue").upsert(rows, {
    onConflict: "crawl_id,url",
    ignoreDuplicates: true,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    message: `${sourceNote}: ${capped.length} URLs in Warteschlange.`,
    pagesDiscovered: capped.length,
  };
}

async function hasPendingUrls(
  supabase: ReturnType<typeof createServiceClient>,
  crawlId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from("dt_crawl_queue")
    .select("id", { count: "exact", head: true })
    .eq("crawl_id", crawlId)
    .in("status", ["pending", "processing"]);
  return (count ?? 0) > 0;
}

async function finishIfEmpty(
  supabase: ReturnType<typeof createServiceClient>,
  crawlId: string,
): Promise<Record<string, unknown>> {
  const stillPending = await hasPendingUrls(supabase, crawlId);
  if (stillPending) {
    await enqueueJob({
      kind: "seo.crawl",
      payload: { crawlId },
      runAfter: new Date(Date.now() + 2000),
    });
    kickJobsWorker(3);
    return { waiting: true };
  }

  const { data: crawl } = await supabase
    .from("dt_site_crawls")
    .select("pages_crawled")
    .eq("id", crawlId)
    .maybeSingle();

  await supabase
    .from("dt_site_crawls")
    .update({
      status: "done",
      finished_at: new Date().toISOString(),
      message: `Abgeschlossen: ${crawl?.pages_crawled ?? 0} Seiten gecrawlt.`,
    })
    .eq("id", crawlId);

  return { done: true, pagesCrawled: crawl?.pages_crawled ?? 0 };
}

async function markCrawlError(
  supabase: ReturnType<typeof createServiceClient>,
  crawlId: string,
  message: string,
) {
  await supabase
    .from("dt_site_crawls")
    .update({
      status: "error",
      message,
      finished_at: new Date().toISOString(),
    })
    .eq("id", crawlId);
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}
