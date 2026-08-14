import { createServiceClient } from "@/lib/supabase/service";

/**
 * If a previous worker died mid-chunk, URLs stay in `processing` forever and
 * claim() returns nothing — the UI spins at "0 of N". Reset them so the crawl
 * can continue.
 */
export async function reclaimStuckCrawlUrls(
  supabase: ReturnType<typeof createServiceClient>,
  crawlId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("dt_crawl_queue")
    .update({ status: "pending" })
    .eq("crawl_id", crawlId)
    .eq("status", "processing")
    .select("id");
  if (error) {
    console.warn("[seo.crawl] reclaim stuck urls failed", error.message);
    return 0;
  }
  return data?.length ?? 0;
}
