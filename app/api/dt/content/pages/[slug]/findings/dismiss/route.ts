import { z } from "zod";

import { loadOrgQuestions } from "@/lib/dt/content/org-questions";
import { keepFinding } from "@/lib/dt/content/pipeline/revise-actions";
import { contentError, contentOk, gateContentRoute, isValidContentSlug, readJsonBody } from "@/lib/dt/content/route-helpers";
import { buildReview, loadContentPage, loadContentSteps } from "@/lib/dt/content/store";

const bodySchema = z.object({ organisationId: z.string().uuid(), finding_key: z.string().min(1).max(4_000) });

/** „So lassen“ on an open point: it goes, the text stays, the page remembers it. Returns the review. */
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
    const result = await keepFinding(gate.service, page, parsed.data.finding_key);
    if (!result.ok) return contentError(result.message, result.status);
    const [fresh, steps, pool] = await Promise.all([
      loadContentPage(gate.service, gate.organisationId, slug),
      loadContentSteps(gate.service, page.id),
      loadOrgQuestions(gate.service, gate.organisationId),
    ]);
    return contentOk({ review: buildReview(fresh ?? page, steps, null, { orgQuestions: pool }) });
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Offener Punkt konnte nicht gespeichert werden.", 500);
  }
}
