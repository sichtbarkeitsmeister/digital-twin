import { z } from "zod";

import { loadOrgQuestions } from "@/lib/dt/content/org-questions";
import { editContentBlockHtml } from "@/lib/dt/content/pipeline/actions";
import { contentError, contentOk, gateContentRoute, isValidContentSlug, readJsonBody } from "@/lib/dt/content/route-helpers";
import { buildReview, loadContentPage, loadContentSteps } from "@/lib/dt/content/store";
import type { ContentReview } from "@/lib/dt/content/types";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  block_id: z.string().trim().min(1).max(200),
  /** The Abschnitt's body as the editor left it; cleaned on the server (paragraphs, lists, emphasis, links). */
  html: z.string().max(60_000),
  /** The heading's new text; empty or missing keeps the old one. */
  heading: z.string().max(300).nullish(),
});

/**
 * „Text direkt ändern“: the page window lets the person click into the text and change an
 * Abschnitt; leaving the Abschnitt saves it here. Allowed while the page has a text and is not
 * running or released (`canEdit`). The answer is the fresh review.
 */
export async function PUT(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Bitte Abschnitt und Text angeben.", 400);
  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const page = await loadContentPage(gate.service, gate.organisationId, slug);
    if (!page) return contentError("Seite nicht gefunden.", 404);
    const result = await editContentBlockHtml(gate.service, page, parsed.data.block_id, {
      heading: parsed.data.heading ?? null,
      bodyHtml: parsed.data.html,
    });
    if (!result.ok) return contentError(result.message, result.status);
    const [fresh, steps, orgQuestions] = await Promise.all([
      loadContentPage(gate.service, gate.organisationId, slug),
      loadContentSteps(gate.service, page.id),
      loadOrgQuestions(gate.service, gate.organisationId),
    ]);
    const review: ContentReview = buildReview(fresh ?? page, steps, null, { orgQuestions });
    return contentOk({ review });
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Text konnte nicht gespeichert werden.", 500);
  }
}
