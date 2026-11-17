import { z } from "zod";

import { contentError, contentOk, gateContentRoute, readJsonBody } from "@/lib/dt/content/route-helpers";
import { loadTextUploadsResult } from "@/lib/dt/content/text-uploads";
import type { ContentTextUploadsResult } from "@/lib/dt/content/types";
import { aiMatchTextUploads } from "@/lib/dt/content/upload-ai-match";

/** One model call of at most 60 s (several at the same time for more than 25 files), plus reads and writes. */
export const maxDuration = 120;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  /** „Mit KI zuordnen“: also the files the AI looked at before. */
  force: z.boolean().optional(),
});

/**
 * „Verbesserung → Texte hochladen“, the AI step between the name match and the manual
 * assignment: files the name rule could not assign are matched to the free pages of the
 * Seitenstruktur by a model. Answers with the table „Hochgeladene Texte“ like the GET, plus
 * `ai_run`. A failed call assigns nothing and answers with the reason.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const result = await aiMatchTextUploads(gate.service, gate.organisationId, { force: parsed.data.force ?? false, userId: gate.userId });
    if (!result.ok) return contentError(result.message, result.status);
    const data: ContentTextUploadsResult = { ...(await loadTextUploadsResult(gate.service, gate.organisationId)), ai_run: result.data };
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Die KI-Zuordnung ist fehlgeschlagen.", 500);
  }
}
