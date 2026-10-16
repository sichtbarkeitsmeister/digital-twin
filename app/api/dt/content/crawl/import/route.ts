import { z } from "zod";

import { loadContentOverview } from "@/lib/dt/content/overview";
import {
  contentError,
  contentOk,
  gateContentRoute,
  loadContentCityCandidates,
  readJsonBody,
} from "@/lib/dt/content/route-helpers";
import { applyStoredContentBriefing, syncContentPagesFromCrawl } from "@/lib/dt/content/store";
import type { ContentCrawlImportResult } from "@/lib/dt/content/types";

export const maxDuration = 300;

const bodySchema = z.object({ organisationId: z.string().uuid() });

/**
 * „Seiten übernehmen“: one row per crawled page of the live site; existing rows keep their
 * text. A Seitenstruktur uploaded in „Verbesserung“ before the crawl briefs the new rows now.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const cities = await loadContentCityCandidates(gate.service, gate.organisationId);
    const synced = await syncContentPagesFromCrawl(gate.service, gate.organisationId, { cities });
    const briefed = await applyStoredContentBriefing(gate.service, gate.organisationId);
    const overview = await loadContentOverview(gate.service, gate.organisationId);
    const data: ContentCrawlImportResult = { ...synced, briefed, overview };
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Seiten konnten nicht übernommen werden.", 500);
  }
}
