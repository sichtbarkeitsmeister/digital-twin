import { z } from "zod";

import { contentError, contentOk, gateContentRoute, readJsonBody } from "@/lib/dt/content/route-helpers";
import { assignTextUpload, loadTextUploadsResult } from "@/lib/dt/content/text-uploads";
import type { ContentTextUploadsResult } from "@/lib/dt/content/types";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  uploadId: z.string().uuid(),
  /** The page of the Seitenstruktur (its slug); null is „Zuordnung lösen“. */
  structureSlug: z.string().trim().min(1).max(200).nullable(),
});

/** The manual assignment of a Word file to a page of the Seitenstruktur, or „Zuordnung lösen“. */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const result = await assignTextUpload(gate.service, gate.organisationId, parsed.data.uploadId, parsed.data.structureSlug);
    if (!result.ok) return contentError(result.message, result.status);
    const data: ContentTextUploadsResult = await loadTextUploadsResult(gate.service, gate.organisationId);
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Zuordnung konnte nicht gespeichert werden.", 500);
  }
}
