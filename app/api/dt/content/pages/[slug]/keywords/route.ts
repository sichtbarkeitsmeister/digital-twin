import { z } from "zod";

import { loadOrgQuestions } from "@/lib/dt/content/org-questions";
import { suggestContentKeywords } from "@/lib/dt/content/pipeline/keywords-suggest";
import { contentError, contentOk, gateContentRoute, isValidContentSlug, readJsonBody } from "@/lib/dt/content/route-helpers";
import { buildReview, loadContentPage, loadContentSteps } from "@/lib/dt/content/store";

export const maxDuration = 240;

const bodySchema = z.object({ organisationId: z.string().uuid(), force: z.boolean().optional() });

/**
 * „Keywords analysieren und eintragen“: the DigitalTwin sets the page's Hauptkeyword and
 * Nebenkeywords (one short call) where the Seitenstruktur has none. Keywords of the
 * Seitenstruktur stay; keywords entered by hand or suggested before stay unless `force`.
 * The page window calls it for one page, the overview for each ticked page in turn, so every
 * call sees the keywords the pages before it got.
 */
export async function POST(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);
  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;
  try {
    const page = await loadContentPage(gate.service, gate.organisationId, slug);
    if (!page) return contentError("Seite nicht gefunden.", 404);
    const result = await suggestContentKeywords(gate.service, page, gate.userId, { force: parsed.data.force });
    if (!result.ok) return contentError(result.message, result.status);
    const [fresh, steps, orgQuestions] = await Promise.all([
      loadContentPage(gate.service, gate.organisationId, slug),
      loadContentSteps(gate.service, page.id),
      loadOrgQuestions(gate.service, gate.organisationId),
    ]);
    return contentOk({
      review: buildReview(fresh ?? page, steps, null, { orgQuestions }),
      cost_eur: result.cost_eur,
      reason: result.reason,
      skipped: result.skipped ?? null,
      no_keyword: result.no_keyword === true,
    });
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Keyword-Analyse fehlgeschlagen.", 500);
  }
}
