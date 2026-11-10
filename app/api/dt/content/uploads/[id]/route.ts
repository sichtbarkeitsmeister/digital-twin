import { z } from "zod";

import { contentError, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";
import { loadTextUploadsResult, removeTextUpload } from "@/lib/dt/content/text-uploads";
import type { ContentTextUploadsResult } from "@/lib/dt/content/types";

/**
 * „Entfernen“: the stored text of one Word file is deleted. A page that used it falls back to
 * a page written from scratch (source „structure“; „crawl“ with a live URL); refused while that
 * page runs.
 */
export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return contentError("Ungültige Datei.", 400);

  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const result = await removeTextUpload(gate.service, gate.organisationId, id);
    if (!result.ok) return contentError(result.message, result.status);
    const data: ContentTextUploadsResult = await loadTextUploadsResult(gate.service, gate.organisationId);
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Datei konnte nicht entfernt werden.", 500);
  }
}
