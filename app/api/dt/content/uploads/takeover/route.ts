import { z } from "zod";

import { loadContentOverview } from "@/lib/dt/content/overview";
import { contentError, contentOk, gateContentRoute, readJsonBody } from "@/lib/dt/content/route-helpers";
import { loadTextUploadsResult, takeOverTextUploads } from "@/lib/dt/content/text-uploads";
import type { ContentTextUploadTakeoverResult } from "@/lib/dt/content/types";

export const maxDuration = 120;

const bodySchema = z.object({ organisationId: z.string().uuid() });

/**
 * „Zugeordnete Seiten übernehmen“: every assigned Word file gets its row in the Texte table —
 * attached to the row of its page when there is one (a started page keeps state and text),
 * created from the Seitenstruktur otherwise, at most 300 rows in total.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const result = await takeOverTextUploads(gate.service, gate.organisationId);
    if (!result.ok) return contentError(result.message, result.status);
    const [uploads, overview] = await Promise.all([
      loadTextUploadsResult(gate.service, gate.organisationId),
      loadContentOverview(gate.service, gate.organisationId),
    ]);
    const data: ContentTextUploadTakeoverResult = { ...result.data, uploads, overview };
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Seiten konnten nicht übernommen werden.", 500);
  }
}
