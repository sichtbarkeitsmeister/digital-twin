import { reclaimStuckCrawlUrls } from "@/lib/dt/seo/reclaim-stuck-crawl-urls";
import { enqueueJob } from "@/lib/jobs/queue";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";
import { createServiceClient } from "@/lib/supabase/service";

const STUCK_NO_PROGRESS_MS = 15 * 60 * 1000;
const STALE_QUEUED_MS = 90_000;

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
    .select("id,status,created_at,started_at,pages_crawled,message")
    .eq("organisation_id", organisationId)
    .in("status", ["queued", "running"]);

  if (crawlId) query = query.eq("id", crawlId);

  const { data: crawls } = await query;
  if (!crawls?.length) return;

  for (const crawl of crawls) {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id,status,last_error,created_at,organisation_id")
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
    const activeJob =
      latest.status === "pending" || latest.status === "running";

    // Worker died after claiming URLs → reclaim and re-enqueue.
    if (crawl.status === "running" && hasWork && !activeJob) {
      await reclaimStuckCrawlUrls(supabase, crawl.id);
      await enqueueJob({
        kind: "seo.crawl",
        organisationId,
        payload: { crawlId: crawl.id, organisationId },
        runAfter: new Date(),
      });
      kickJobsWorker(5);
      continue;
    }

    const startedAt = crawl.started_at ?? crawl.created_at;
    const stuckMs = Date.now() - new Date(startedAt).getTime();
    if (
      crawl.status === "running" &&
      (crawl.pages_crawled ?? 0) === 0 &&
      stuckMs > STUCK_NO_PROGRESS_MS &&
      hasWork
    ) {
      await reclaimStuckCrawlUrls(supabase, crawl.id);
      if (!activeJob) {
        await enqueueJob({
          kind: "seo.crawl",
          organisationId,
          payload: { crawlId: crawl.id, organisationId },
          runAfter: new Date(),
        });
      }
      kickJobsWorker(5);
      await supabase
        .from("dt_site_crawls")
        .update({
          message:
            "Crawl hing — Warteschlange neu gestartet. Bitte kurz warten …",
        })
        .eq("id", crawl.id)
        .eq("status", "running");
    }
  }
}
