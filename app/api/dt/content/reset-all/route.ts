import { z } from "zod";

import { loadContentOverview } from "@/lib/dt/content/overview";
import { resetContentTool } from "@/lib/dt/content/pipeline/actions";
import { contentError, contentOk, gateContentRoute, readJsonBody } from "@/lib/dt/content/route-helpers";
import type { ContentToolResetResult } from "@/lib/dt/content/types";

export const maxDuration = 120;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  /** Also forget the confirmed settings (Anrede, Branche, Tonalität, verbotene Wörter, Avatar). Default on. */
  settings: z.boolean().optional(),
  /** Also remove the uploaded Seitenstruktur, so no page comes back on the next load. Default on. */
  structure: z.boolean().optional(),
});

/**
 * „Texte komplett zurücksetzen“: the tool for this organisation back to an empty start.
 * Pages, steps, questions, cost, open jobs, settings and the Seitenstruktur go; the crawl of
 * the website, avatars and Anbieterfakten stay. Same access rule as every content route.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const reset = await resetContentTool(gate.service, gate.organisationId, {
      settings: parsed.data.settings ?? true,
      structure: parsed.data.structure ?? true,
    });
    if (!reset.ok) return contentError(reset.message, reset.status);
    const overview = await loadContentOverview(gate.service, gate.organisationId);
    const data: ContentToolResetResult = { ...reset.counts, overview };
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Texte konnten nicht zurückgesetzt werden.", 500);
  }
}
