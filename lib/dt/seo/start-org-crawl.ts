import "server-only";

import { syncCrawlJobHealth } from "@/lib/dt/seo/sync-crawl-job-health";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";
import { enqueueJob } from "@/lib/jobs/queue";
import { createServiceClient } from "@/lib/supabase/service";

export type OrgCrawlProgress = {
  id: string;
  status: string;
  pagesCrawled: number;
  pagesDiscovered: number;
  maxPages: number;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type OrgCrawlStatusSnapshot = {
  pageCount: number;
  websiteUrl: string | null;
  lastCrawledAt: string | null;
  lastCrawlError: string | null;
  crawl: OrgCrawlProgress | null;
};

export async function loadOrgCrawlStatusSnapshot(
  organisationId: string,
): Promise<OrgCrawlStatusSnapshot> {
  const supabase = createServiceClient();
  await syncCrawlJobHealth(organisationId);

  const [{ data: config }, { count }, { data: latestPage }, { data: active }, { data: lastCrawl }] =
    await Promise.all([
      supabase
        .from("dt_org_config")
        .select("website_url,sitemap_url")
        .eq("organisation_id", organisationId)
        .maybeSingle(),
      supabase
        .from("dt_site_pages")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", organisationId)
        .eq("is_excluded", false),
      supabase
        .from("dt_site_pages")
        .select("crawled_at")
        .eq("organisation_id", organisationId)
        .eq("is_excluded", false)
        .order("crawled_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("dt_site_crawls")
        .select(
          "id,status,pages_crawled,pages_discovered,max_pages,message,started_at,finished_at",
        )
        .eq("organisation_id", organisationId)
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("dt_site_crawls")
        .select("status,message,finished_at")
        .eq("organisation_id", organisationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  return {
    pageCount: count ?? 0,
    websiteUrl: config?.website_url?.trim() || null,
    lastCrawledAt: latestPage?.crawled_at ?? null,
    lastCrawlError:
      lastCrawl?.status === "error" ? (lastCrawl.message ?? "Crawl fehlgeschlagen.") : null,
    crawl: active
      ? {
          id: active.id,
          status: active.status,
          pagesCrawled: active.pages_crawled,
          pagesDiscovered: active.pages_discovered,
          maxPages: active.max_pages,
          message: active.message,
          startedAt: active.started_at,
          finishedAt: active.finished_at,
        }
      : null,
  };
}

export async function startOrganisationSiteCrawl(input: {
  organisationId: string;
  userId: string;
}): Promise<
  | {
      ok: true;
      crawlId: string;
      reused: boolean;
      status: string;
      message: string;
      pagesCrawled?: number;
      pagesDiscovered?: number;
    }
  | { ok: false; message: string }
> {
  const service = createServiceClient();
  const { data: config } = await service
    .from("dt_org_config")
    .select("website_url,sitemap_url")
    .eq("organisation_id", input.organisationId)
    .maybeSingle();

  if (!config) {
    return { ok: false, message: "Organisation nicht gefunden." };
  }
  if (!config.website_url?.trim() && !config.sitemap_url?.trim()) {
    return {
      ok: false,
      message: "Bitte zuerst Website- oder Sitemap-URL unter SEO hinterlegen.",
    };
  }

  await syncCrawlJobHealth(input.organisationId);

  const { data: existing } = await service
    .from("dt_site_crawls")
    .select("id,status,pages_crawled,pages_discovered,message")
    .eq("organisation_id", input.organisationId)
    .in("status", ["queued", "running"])
    .maybeSingle();

  if (existing) {
    kickJobsWorker();
    return {
      ok: true,
      crawlId: existing.id,
      reused: true,
      status: existing.status,
      message: existing.message ?? "Crawl läuft bereits.",
      pagesCrawled: existing.pages_crawled,
      pagesDiscovered: existing.pages_discovered,
    };
  }

  const { data: crawl, error: insertError } = await service
    .from("dt_site_crawls")
    .insert({
      organisation_id: input.organisationId,
      status: "queued",
      created_by_user_id: input.userId,
      message: "Crawl in Warteschlange …",
    })
    .select("id")
    .single();

  if (insertError || !crawl) {
    return {
      ok: false,
      message: insertError?.message ?? "Crawl konnte nicht gestartet werden.",
    };
  }

  const enqueued = await enqueueJob({
    kind: "seo.crawl",
    organisationId: input.organisationId,
    payload: { crawlId: crawl.id, organisationId: input.organisationId },
    runAfter: new Date(),
  });

  if (!enqueued.ok) {
    await service
      .from("dt_site_crawls")
      .update({
        status: "error",
        message: enqueued.error,
        finished_at: new Date().toISOString(),
      })
      .eq("id", crawl.id);
    return { ok: false, message: enqueued.error };
  }

  kickJobsWorker(5);

  return {
    ok: true,
    crawlId: crawl.id,
    reused: false,
    status: "queued",
    message: "Hintergrund-Crawl gestartet.",
  };
}
