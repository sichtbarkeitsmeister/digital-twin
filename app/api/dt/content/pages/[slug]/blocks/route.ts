import { z } from "zod";

import { loadOrgQuestions } from "@/lib/dt/content/org-questions";
import { addContentBlock, deleteContentBlock } from "@/lib/dt/content/pipeline/actions";
import { contentError, contentOk, gateContentRoute, isValidContentSlug, readJsonBody } from "@/lib/dt/content/route-helpers";
import { buildReview, loadContentPage, loadContentSteps } from "@/lib/dt/content/store";
import type { ContentPageRow } from "@/lib/dt/content/store";

const addSchema = z.object({
  organisationId: z.string().uuid(),
  after_block_id: z.string().trim().min(1).max(200),
  heading: z.string().max(300),
  level: z.number().int().min(2).max(4).default(2),
  /** The body as typed: blank line = paragraph, „- “ = list item. */
  text: z.string().max(50_000),
});

const deleteSchema = z.object({
  organisationId: z.string().uuid(),
  block_id: z.string().trim().min(1).max(200),
});

async function freshReview(
  gate: { service: Parameters<typeof loadContentPage>[0]; organisationId: string },
  slug: string,
  fallback: ContentPageRow,
) {
  const [fresh, steps, orgQuestions] = await Promise.all([
    loadContentPage(gate.service, gate.organisationId, slug),
    loadContentSteps(gate.service, fallback.id),
    loadOrgQuestions(gate.service, gate.organisationId),
  ]);
  return buildReview(fresh ?? fallback, steps, null, { orgQuestions });
}

/**
 * „Abschnitt einfügen“: an own Abschnitt with heading (H2–H4) and text after a given one. Allowed while the page
 * has a text, does not run and is not released. The answer is the fresh review and the new id.
 */
export async function POST(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);
  const parsed = addSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Bitte Überschrift und Text für den neuen Abschnitt angeben.", 400);
  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;
  try {
    const page = await loadContentPage(gate.service, gate.organisationId, slug);
    if (!page) return contentError("Seite nicht gefunden.", 404);
    const result = await addContentBlock(gate.service, page, {
      afterBlockId: parsed.data.after_block_id,
      heading: parsed.data.heading,
      level: parsed.data.level,
      text: parsed.data.text,
    });
    if (!result.ok) return contentError(result.message, result.status);
    return contentOk({ review: await freshReview(gate, slug, page), block_id: result.blockId ?? null });
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Abschnitt konnte nicht eingefügt werden.", 500);
  }
}

/** „Abschnitt löschen“. The H1 and the last Abschnitt stay. The answer is the fresh review. */
export async function DELETE(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);
  const parsed = deleteSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Bitte den Abschnitt angeben.", 400);
  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;
  try {
    const page = await loadContentPage(gate.service, gate.organisationId, slug);
    if (!page) return contentError("Seite nicht gefunden.", 404);
    const result = await deleteContentBlock(gate.service, page, parsed.data.block_id);
    if (!result.ok) return contentError(result.message, result.status);
    return contentOk({ review: await freshReview(gate, slug, page) });
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Abschnitt konnte nicht gelöscht werden.", 500);
  }
}
