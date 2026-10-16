import { z } from "zod";

import { loadContentOverview } from "@/lib/dt/content/overview";
import { contentError, contentOk, gateContentRoute, readJsonBody } from "@/lib/dt/content/route-helpers";
import { contentStructurePlanResult, createMissingContentPages, loadContentStructurePlan } from "@/lib/dt/content/store";
import type { ContentStructureCreateResult } from "@/lib/dt/content/types";

export const maxDuration = 120;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  /** The slugs the list showed; only pages still missing are created. */
  slugs: z.array(z.string().trim().min(1).max(80)).min(1).max(300),
});

/**
 * „Diese Seiten anlegen“ in „Verbesserung“: the listed pages of the Seitenstruktur that the
 * website does not have become rows, like a „Neue Website“ upload creates them.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const created = await createMissingContentPages(gate.service, gate.organisationId, parsed.data.slugs);
    const [state, overview] = await Promise.all([
      loadContentStructurePlan(gate.service, gate.organisationId),
      loadContentOverview(gate.service, gate.organisationId),
    ]);
    const data: ContentStructureCreateResult = { created, plan: contentStructurePlanResult(state), overview };
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Seiten konnten nicht angelegt werden.", 500);
  }
}
