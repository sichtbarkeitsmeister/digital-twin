import { z } from "zod";

import { skipReason, startContentRun } from "@/lib/dt/content/pipeline/actions";
import {
  contentError,
  contentOk,
  gateContentRoute,
  isValidContentSlug,
  readJsonBody,
} from "@/lib/dt/content/route-helpers";
import { loadContentPages, loadContentSettings, syncContentPagesFromStructure } from "@/lib/dt/content/store";
import type { ContentRunThroughResult } from "@/lib/dt/content/types";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";

export const maxDuration = 300;

const bodySchema = z.union([
  z.object({
    organisationId: z.string().uuid(),
    pages: z.array(z.string().refine(isValidContentSlug)).min(1).max(500),
  }),
  z.object({
    organisationId: z.string().uuid(),
    all: z.literal(true),
  }),
]);

/** "Texte erstellen": one background job per selected page. */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Bitte mindestens eine Seite auswählen.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  let pages;
  try {
    const settings = await loadContentSettings(gate.service, gate.organisationId);
    if (!settings) return contentError("Bitte erst die Einstellungen für Texte bestätigen.", 400);

    await syncContentPagesFromStructure(gate.service, gate.organisationId).catch(() => null);
    pages = await loadContentPages(gate.service, gate.organisationId);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Seiten konnten nicht geladen werden.", 500);
  }
  const wanted =
    "all" in parsed.data
      ? pages
      : pages.filter((p) => (parsed.data as { pages: string[] }).pages.includes(p.slug));
  if (wanted.length === 0) return contentError("Keine passende Seite gefunden.", 404);

  const result: ContentRunThroughResult = { jobs: [], skipped: [] };
  for (const page of wanted) {
    const reason = skipReason(page);
    if (reason) {
      result.skipped.push({ page: page.name, reason });
      continue;
    }
    const started = await startContentRun(gate.service, page, gate.userId);
    if (!started.ok) {
      result.skipped.push({ page: page.name, reason: started.message });
      continue;
    }
    result.jobs.push({
      id: started.jobId ?? page.id,
      slug: page.slug,
      page: page.name,
      state: "running",
      status_url: `/api/dt/content/jobs/${started.jobId ?? page.id}`,
    });
  }

  if (result.jobs.length > 0) kickJobsWorker(Math.min(result.jobs.length, 3));
  return contentOk(result, 202);
}
