import { z } from "zod";

import { loadOrgQuestions } from "@/lib/dt/content/org-questions";
import { ContentLlmError, llmErrorMessage } from "@/lib/dt/content/pipeline/llm";
import { applyProposals } from "@/lib/dt/content/pipeline/revise-actions";
import { contentError, contentOk, gateContentRoute, isValidContentSlug, readJsonBody } from "@/lib/dt/content/route-helpers";
import { buildReview, loadContentPage, loadContentSteps } from "@/lib/dt/content/store";

export const maxDuration = 300;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  block_id: z.string().min(1).max(80),
  finding_keys: z.array(z.string().min(1).max(4_000)).min(1).max(20),
  /** The points that go with this Abschnitt (a point about several goes with its last one). */
  done_keys: z.array(z.string().min(1).max(4_000)).max(20).optional().nullable(),
  /** „Kunde prüft“: the answer „KUNDE PRÜFT“ for exactly one open point, as under „Eigene Angabe“. */
  info: z.string().max(200).optional().nullable(),
});

/**
 * „Jetzt umsetzen“, one Abschnitt per call: the proposals of the chosen open points are worked in
 * and taken over at once (the page window calls this once per Abschnitt). Returns the review.
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
    const steps = await loadContentSteps(gate.service, page.id);
    const result = await applyProposals(gate.service, page, steps, parsed.data, gate.userId);
    if (!result.ok) {
      const reasons = result.reasons?.length ? ` (${result.reasons.join("; ")})` : "";
      return contentError(`${result.message}${reasons}`, result.status);
    }
    const [fresh, freshSteps, pool] = await Promise.all([
      loadContentPage(gate.service, gate.organisationId, slug),
      loadContentSteps(gate.service, page.id),
      loadOrgQuestions(gate.service, gate.organisationId),
    ]);
    return contentOk({ review: buildReview(fresh ?? page, freshSteps, null, { orgQuestions: pool }), cost_eur: result.cost_eur });
  } catch (error) {
    if (error instanceof ContentLlmError) return contentError(error.message, error.retryable ? 503 : 400);
    return contentError(llmErrorMessage(error), 502);
  }
}
