import { reclaimStuckCrawlUrls } from "@/lib/dt/seo/reclaim-stuck-crawl-urls";
import { enqueueJob } from "@/lib/jobs/queue";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";
import { createServiceClient } from "@/lib/supabase/service";

const STALE_QUEUED_MS = 90_000;
/** Worker HTTP ticks are often killed before a chunk finishes; treat silence as dead. */
export const STALE_CRAWL_PROGRESS_MS = 90_000;

export function crawlJobDedupeKey(crawlId: string): string {
  return `seo.crawl:${crawlId}`;
}

export function isStaleCrawlProgress(
  updatedAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!updatedAt) return true;
  const ts = new Date(updatedAt).getTime();
  if (Number.isNaN(ts)) return true;
  return now - ts > STALE_CRAWL_PROGRESS_MS;
}

/**
 * Keep crawl UI honest: recover from dead jobs, stuck `processing` URLs, and
 * crawls that never progressed after the worker was killed mid-chunk.
 */
export async function syncCrawlJobHealth(
  organisationId: string,
  crawlId?: string,
): Promise<void> {
  const supabase = createServiceClient();

  let query = supabase
    .from("dt_site_crawls")
    .select("id,status,created_at,started_at,pages_crawled,message,updated_at")
    .eq("organisation_id", organisationId)
    .in("status", ["queued", "running"]);

  if (crawlId) query = query.eq("id", crawlId);

  const { data: crawls } = await query;
  if (!crawls?.length) return;

  for (const crawl of crawls) {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id,status,last_error,created_at,locked_at,organisation_id")
      .eq("kind", "seo.crawl")
      .contains("payload", { crawlId: crawl.id })
      .order("created_at", { ascending: false })
      .limit(5);

    const latest = jobs?.[0];
    if (!latest) {
      const ageMs = Date.now() - new Date(crawl.created_at).getTime();
      if (crawl.status === "queued" && ageMs > STALE_QUEUED_MS) {
        await supabase
          .from("dt_site_crawls")
          .update({
            status: "error",
            message: "Crawl-Job nicht gestartet. Bitte erneut versuchen.",
            finished_at: new Date().toISOString(),
          })
          .eq("id", crawl.id);
      }
      continue;
    }

    if (latest.status === "dead") {
      await supabase
        .from("dt_site_crawls")
        .update({
          status: "error",
          message: latest.last_error ?? "Crawl-Job fehlgeschlagen.",
          finished_at: new Date().toISOString(),
        })
        .eq("id", crawl.id)
        .in("status", ["queued", "running"]);
      continue;
    }

    const { count: pendingCount } = await supabase
      .from("dt_crawl_queue")
      .select("id", { count: "exact", head: true })
      .eq("crawl_id", crawl.id)
      .in("status", ["pending", "processing"]);

    const hasWork = (pendingCount ?? 0) > 0;
    const stale = isStaleCrawlProgress(
      crawl.updated_at ?? crawl.started_at ?? crawl.created_at,
    );
    const activeJob = latest.status === "pending" || latest.status === "running";

    if (stale && latest.status === "running") {
      await reclaimStuckCrawlUrls(supabase, crawl.id);
      await supabase
        .from("jobs")
        .update({
          status: "pending",
          locked_at: null,
          locked_by: null,
          run_after: new Date().toISOString(),
          last_error: "Crawl-Chunk abgebrochen — wird fortgesetzt.",
        })
        .eq("id", latest.id)
        .eq("status", "running");
      await supabase
        .from("dt_site_crawls")
        .update({
          message: "Crawl hing — wird fortgesetzt …",
        })
        .eq("id", crawl.id)
        .eq("status", "running");
      kickJobsWorker(5);
      continue;
    }

    if (crawl.status === "running" && hasWork && !activeJob) {
      await reclaimStuckCrawlUrls(supabase, crawl.id);
      await enqueueJob({
        kind: "seo.crawl",
        organisationId,
        payload: { crawlId: crawl.id, organisationId },
        dedupeKey: crawlJobDedupeKey(crawl.id),
        runAfter: new Date(),
      });
      kickJobsWorker(5);
      continue;
    }

    if (crawl.status === "queued" || (hasWork && latest.status === "pending")) {
      kickJobsWorker(3);
    }
  }
}
