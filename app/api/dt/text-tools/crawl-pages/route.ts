import { contentError, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";
import { loadCrawlSourcePages } from "@/lib/dt/text-tools/crawl-source";

/**
 * The crawled pages of the organisation as the text tools list them (SEO, GEO, Hormozi):
 * the same selection as „Seiten übernehmen“ in Texte, without writing anything. Starting
 * and watching the crawl uses `/api/dt/content/crawl`, exactly as Texte does.
 */
export async function GET(req: Request) {
  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  try {
    return contentOk(await loadCrawlSourcePages(gated.gate.service, gated.gate.organisationId));
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Die Seiten aus dem Crawl konnten nicht geladen werden.", 500);
  }
}
