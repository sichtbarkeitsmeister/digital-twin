import { createServiceClient } from "@/lib/supabase/service";

/**
 * If a crawl is still queued but its job already failed, surface the error on
 * the crawl row so the UI does not spin forever.
 */
export async function syncCrawlJobHealth(
  organisationId: string,
  crawlId?: string,
): Promise<void> {
  const supabase = createServiceClient();

  let query = supabase
    .from("dt_site_crawls")
    .select("id,status,created_at")
    .eq("organisation_id", organisationId)
    .in("status", ["queued", "running"]);

  if (crawlId) query = query.eq("id", crawlId);

  const { data: crawls } = await query;
  if (!crawls?.length) return;

  for (const crawl of crawls) {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id,status,last_error,created_at")
      .eq("kind", "seo.crawl")
      .contains("payload", { crawlId: crawl.id })
      .order("created_at", { ascending: false })
      .limit(3);

    const latest = jobs?.[0];
    if (!latest) {
      const ageMs = Date.now() - new Date(crawl.created_at).getTime();
      if (crawl.status === "queued" && ageMs > 90_000) {
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
    }
  }
}
