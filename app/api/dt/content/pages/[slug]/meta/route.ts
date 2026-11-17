import { z } from "zod";

import { loadOrgQuestions } from "@/lib/dt/content/org-questions";
import { CONTENT_META_MAX, CONTENT_TITLE_MAX, editContentMeta } from "@/lib/dt/content/pipeline/actions";
import { contentError, contentOk, gateContentRoute, isValidContentSlug, readJsonBody } from "@/lib/dt/content/route-helpers";
import { buildReview, loadContentPage, loadContentSteps } from "@/lib/dt/content/store";

const bodySchema = z
  .object({
    organisationId: z.string().uuid(),
    title: z.string().max(CONTENT_TITLE_MAX * 2).nullish(),
    meta_description: z.string().max(CONTENT_META_MAX * 2).nullish(),
  })
  .refine((b) => b.title !== undefined || b.meta_description !== undefined);

/**
 * „Title und Meta-Description ändern“: both sit above the text in the page window and can be
 * changed by hand. Only the fields sent change; an empty one is cleared. The answer is the fresh review.
 */
export async function PUT(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Bitte Title oder Meta-Description angeben.", 400);
  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const page = await loadContentPage(gate.service, gate.organisationId, slug);
    if (!page) return contentError("Seite nicht gefunden.", 404);
    const result = await editContentMeta(gate.service, page, { title: parsed.data.title, metaDescription: parsed.data.meta_description });
    if (!result.ok) return contentError(result.message, result.status);
    const [fresh, steps, orgQuestions] = await Promise.all([
      loadContentPage(gate.service, gate.organisationId, slug),
      loadContentSteps(gate.service, page.id),
      loadOrgQuestions(gate.service, gate.organisationId),
    ]);
    return contentOk({ review: buildReview(fresh ?? page, steps, null, { orgQuestions }) });
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Title und Meta-Description konnten nicht gespeichert werden.", 500);
  }
}
