import { z } from "zod";

import { loadOrgQuestions } from "@/lib/dt/content/org-questions";
import { REVISE_INSTRUCTION_MAX } from "@/lib/dt/content/pipeline/revise";
import { applyRevision } from "@/lib/dt/content/pipeline/revise-actions";
import { contentError, contentOk, gateContentRoute, isValidContentSlug, readJsonBody } from "@/lib/dt/content/route-helpers";
import { buildReview, loadContentPage, loadContentSteps } from "@/lib/dt/content/store";

const blockSchema = z.object({ heading: z.string().max(1_000).nullable(), html: z.string().max(40_000) });
const bodySchema = z.object({
  organisationId: z.string().uuid(),
  block_id: z.string().min(1).max(80),
  before: blockSchema,
  after: blockSchema,
  instruction: z.string().max(REVISE_INSTRUCTION_MAX).optional().nullable(),
  info: z.string().max(REVISE_INSTRUCTION_MAX).optional().nullable(),
  finding_key: z.string().max(4_000).optional().nullable(),
});

/** „Übernehmen“: the previewed Abschnitt replaces the stored one; returns the review. */
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
    const result = await applyRevision(gate.service, page, parsed.data);
    if (!result.ok) return contentError(result.message, result.status);
    const [fresh, steps, pool] = await Promise.all([
      loadContentPage(gate.service, gate.organisationId, slug),
      loadContentSteps(gate.service, page.id),
      loadOrgQuestions(gate.service, gate.organisationId),
    ]);
    return contentOk({ review: buildReview(fresh ?? page, steps, null, { orgQuestions: pool }) });
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Abschnitt konnte nicht gespeichert werden.", 500);
  }
}
