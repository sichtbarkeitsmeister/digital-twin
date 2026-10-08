import { z } from "zod";

import { contentError, contentOk, gateContentRoute, readJsonBody } from "@/lib/dt/content/route-helpers";
import { contentDbErrorMessage } from "@/lib/dt/content/store";
import type { ContentCrawlStatus } from "@/lib/dt/content/types";
import { loadOrgCrawlStatusSnapshot, startOrganisationSiteCrawl } from "@/lib/dt/seo/start-org-crawl";

/** Starting or checking a crawl may continue the job worker after the response (`after()`). */
export const maxDuration = 120;

const bodySchema = z.object({ organisationId: z.string().uuid() });

/** Crawler mode of „Seiten“: what the crawl of the live site has, and whether one is running. */
export async function GET(req: Request) {
  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const [snapshot, { count, error }] = await Promise.all([
      loadOrgCrawlStatusSnapshot(gate.organisationId),
      gate.service
        .from("dt_content_pages")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", gate.organisationId)
        .eq("source", "crawl"),
    ]);
    if (error) return contentError(contentDbErrorMessage(error, "Seiten konnten nicht geladen werden"), 500);

    const data: ContentCrawlStatus = {
      website_url: snapshot.websiteUrl,
      crawl: snapshot.crawl
        ? {
            id: snapshot.crawl.id,
            status: snapshot.crawl.status,
            pages_crawled: snapshot.crawl.pagesCrawled,
            pages_discovered: snapshot.crawl.pagesDiscovered,
            max_pages: snapshot.crawl.maxPages,
            message: snapshot.crawl.message,
            started_at: snapshot.crawl.startedAt,
          }
        : null,
      last_crawl_error: snapshot.lastCrawlError,
      page_count: snapshot.pageCount,
      last_crawled_at: snapshot.lastCrawledAt,
      imported: count ?? 0,
    };
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Crawl-Status konnte nicht geladen werden.", 500);
  }
}

/** „Website crawlen“: the same background crawl as SEO Modus (sitemap + internal links). */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const started = await startOrganisationSiteCrawl({ organisationId: gate.organisationId, userId: gate.userId });
  if (!started.ok) {
    return contentError(started.message, /Website- oder Sitemap/i.test(started.message) ? 400 : 500);
  }
  return contentOk(
    { crawl_id: started.crawlId, reused: started.reused, status: started.status, message: started.message },
    202,
  );
}
