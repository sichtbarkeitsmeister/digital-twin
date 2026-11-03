import { z } from "zod";

import { loadOrgQuestions } from "@/lib/dt/content/org-questions";
import { submitContentAnswers } from "@/lib/dt/content/pipeline/actions";
import { contentError, contentOk, gateContentRoute, isValidContentSlug, readJsonBody } from "@/lib/dt/content/route-helpers";
import { buildReview, loadContentPage, loadContentSteps } from "@/lib/dt/content/store";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";

export const maxDuration = 300;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  answers: z
    .array(z.object({ id: z.string().min(1).max(80), action: z.enum(["answer", "drop"]), answer: z.string().max(2_000).optional().nullable() }))
    .max(20),
  submit: z.boolean().optional(),
});

/**
 * Answers at the page's one stop („Braucht Sie“ before the Watermark Entfernung): each question
 * answered or „Ohne Angabe weiter“; with `submit` („Antworten einarbeiten & weiter“) the short
 * pass runs and the page goes on. Also the answer to the one „grundlegend“ question of the
 * Faktencheck. Returns the review.
 */
export async function POST(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Antworten.", 400);
  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;
  try {
    const page = await loadContentPage(gate.service, gate.organisationId, slug);
    if (!page) return contentError("Seite nicht gefunden.", 404);
    const result = await submitContentAnswers(gate.service, page, { answers: parsed.data.answers, submit: parsed.data.submit === true }, gate.userId);
    if (!result.ok) return contentError(result.message, result.status);
    if (result.jobId) kickJobsWorker(1);
    const [fresh, steps, pool] = await Promise.all([
      loadContentPage(gate.service, gate.organisationId, slug),
      loadContentSteps(gate.service, page.id),
      loadOrgQuestions(gate.service, gate.organisationId),
    ]);
    return contentOk({ job_id: result.jobId, review: buildReview(fresh ?? page, steps, null, { orgQuestions: pool }) });
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Antworten konnten nicht gespeichert werden.", 500);
  }
}
