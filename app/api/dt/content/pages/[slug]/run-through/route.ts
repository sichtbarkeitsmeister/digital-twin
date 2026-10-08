import { z } from "zod";

import { startContentRun } from "@/lib/dt/content/pipeline/actions";
import { reconcileContentPages } from "@/lib/dt/content/pipeline/health";
import {
  contentError,
  contentOk,
  gateContentRoute,
  isValidContentSlug,
  readJsonBody,
} from "@/lib/dt/content/route-helpers";
import { loadContentPage, loadContentSettings } from "@/lib/dt/content/store";
import type { ContentPageRunThroughResult } from "@/lib/dt/content/types";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";

export const maxDuration = 300;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  force: z.boolean().optional(),
});

/** "Weiterlaufen lassen" for one page. */
export async function POST(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);

  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  let page;
  let settings;
  try {
    [page, settings] = await Promise.all([
      loadContentPage(gate.service, gate.organisationId, slug),
      loadContentSettings(gate.service, gate.organisationId),
    ]);
    if (!page) return contentError("Seite nicht gefunden.", 404);
    if (!settings) return contentError("Bitte erst die Einstellungen für Texte bestätigen.", 400);
    // A page whose job died stays „läuft“ only until someone looks: repair before deciding.
    page = (await reconcileContentPages(gate.service, [page])).pages[0] ?? page;
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Seite konnte nicht geladen werden.", 500);
  }

  const started = await startContentRun(gate.service, page, gate.userId);
  if (!started.ok) return contentError(started.message, started.status);

  kickJobsWorker(1);
  const data: ContentPageRunThroughResult = {
    id: started.jobId ?? page.id,
    status_url: `/api/dt/content/jobs/${started.jobId ?? page.id}`,
  };
  return contentOk(data, 202);
}
