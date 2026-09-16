import "server-only";

import { GSC_PAGES_MAX_INGEST, mapGscAnalyticsRows } from "@/lib/dt/seo/gsc-pages";
import { isSameCrawlSite, normaliseUrl } from "@/lib/dt/seo/crawl-url";
import { enqueueJob } from "@/lib/jobs/queue";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";
import { createServiceClient } from "@/lib/supabase/service";

export type GscPageIngestInput = {
  organisationId: string;
  crawlId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  error?: string | null;
  pages?: Array<{
    url?: string;
    keys?: string[];
    clicks?: number;
    impressions?: number;
    ctr?: number | null;
    position?: number | null;
  }>;
};

export async function ingestGscPages(input: GscPageIngestInput): Promise<{
  ok: true;
  stored: number;
  queued: number;
  resumed: boolean;
  gscSyncStatus: string;
}> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  const gscSyncStatus = input.error?.trim() ? "error" : "done";

  const { data: config } = await supabase
    .from("dt_org_config")
    .select("website_url")
    .eq("organisation_id", input.organisationId)
    .maybeSingle();

  let origin: string | null = null;
  if (config?.website_url) {
    try {
      origin = new URL(normaliseUrl(config.website_url) ?? config.website_url).origin;
    } catch {
      origin = null;
    }
  }

  const mapped = mapGscAnalyticsRows(input.pages ?? [], origin).slice(0, GSC_PAGES_MAX_INGEST);

  if (mapped.length > 0) {
    for (let i = 0; i < mapped.length; i += 200) {
      const chunk = mapped.slice(i, i + 200).map((row) => ({
        organisation_id: input.organisationId,
        url: row.url,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        period_start: input.startDate ?? null,
        period_end: input.endDate ?? null,
        fetched_at: now,
        updated_at: now,
      }));
      const { error } = await supabase
        .from("dt_seo_gsc_pages")
        .upsert(chunk, { onConflict: "organisation_id,url" });
      if (error) throw new Error(error.message);
    }
  }

  const crawl = await resolveCrawl(supabase, input.organisationId, input.crawlId);
  let queued = 0;
  let resumed = false;

  if (
    crawl &&
    mapped.length > 0 &&
    (crawl.status === "queued" || crawl.status === "running" || crawl.status === "done")
  ) {
    const rows = mapped
      .map((row) => {
        const url = normaliseUrl(row.url);
        if (!url) return null;
        if (origin && !isSameCrawlSite(url, origin)) return null;
        return {
          crawl_id: crawl.id,
          organisation_id: input.organisationId,
          url,
          depth: 0,
          status: "pending",
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    if (rows.length > 0) {
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from("dt_crawl_queue").upsert(rows.slice(i, i + 200), {
          onConflict: "crawl_id,url",
          ignoreDuplicates: true,
        });
        if (error) throw new Error(error.message);
      }
      const { count: pendingCount } = await supabase
        .from("dt_crawl_queue")
        .select("id", { count: "exact", head: true })
        .eq("crawl_id", crawl.id)
        .eq("status", "pending");
      queued = pendingCount ?? 0;
    }

    if (crawl.status === "done" && queued > 0) {
      await supabase
        .from("dt_site_crawls")
        .update({
          status: "running",
          finished_at: null,
          message: "GSC-URLs nachgeladen — Crawl wird fortgesetzt.",
        })
        .eq("id", crawl.id);
      resumed = true;
      await enqueueJob({
        kind: "seo.crawl",
        organisationId: input.organisationId,
        payload: { crawlId: crawl.id, organisationId: input.organisationId },
        runAfter: new Date(),
      });
      kickJobsWorker(5);
    } else if (crawl.status === "queued" || crawl.status === "running") {
      await enqueueJob({
        kind: "seo.crawl",
        organisationId: input.organisationId,
        payload: { crawlId: crawl.id, organisationId: input.organisationId },
        runAfter: new Date(),
      });
      kickJobsWorker(3);
    }
  }

  if (crawl) {
    const patch: Record<string, unknown> = { gsc_sync_status: gscSyncStatus };
    if (gscSyncStatus === "error" && input.error?.trim()) {
      patch.message = `GSC-Abgleich fehlgeschlagen: ${input.error.trim()}`;
    }
    await supabase.from("dt_site_crawls").update(patch).eq("id", crawl.id);
  }

  return { ok: true, stored: mapped.length, queued, resumed, gscSyncStatus };
}

async function resolveCrawl(
  supabase: ReturnType<typeof createServiceClient>,
  organisationId: string,
  crawlId?: string | null,
): Promise<{ id: string; status: string; message: string | null } | null> {
  if (crawlId) {
    const { data } = await supabase
      .from("dt_site_crawls")
      .select("id,status,message")
      .eq("id", crawlId)
      .maybeSingle();
    return data ?? null;
  }

  const { data: active } = await supabase
    .from("dt_site_crawls")
    .select("id,status,message")
    .eq("organisation_id", organisationId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (active) return active;

  const { data: last } = await supabase
    .from("dt_site_crawls")
    .select("id,status,message")
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return last ?? null;
}
