import { z } from "zod";

import { loadContentOverview } from "@/lib/dt/content/overview";
import { CONTENT_PAGE_TYPES } from "@/lib/dt/content/page-types";
import { deleteContentPage } from "@/lib/dt/content/pipeline/actions";
import {
  contentError,
  contentOk,
  gateContentRoute,
  isValidContentSlug,
  readJsonBody,
} from "@/lib/dt/content/route-helpers";
import {
  buildReview,
  contentPageTypeChangeBlocker,
  loadContentPage,
  loadContentSteps,
  updateContentPageType,
} from "@/lib/dt/content/store";
import type { ContentPagePatchResult } from "@/lib/dt/content/types";

const patchSchema = z.object({
  organisationId: z.string().uuid(),
  page_type: z.enum(CONTENT_PAGE_TYPES),
});

/**
 * „Seitentyp“ in the drawer. Only crawl pages: their type is a guess from name and depth and
 * the editor corrects it by hand (not while the page runs). Pages from the Excel keep the
 * type the Excel gave them; a corrected Excel is the way to change it.
 */
export async function PATCH(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);

  const parsed = patchSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültiger Seitentyp.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const page = await loadContentPage(gate.service, gate.organisationId, slug);
    if (!page) return contentError("Seite nicht gefunden.", 404);
    const blocker = contentPageTypeChangeBlocker(page);
    if (blocker) return contentError(blocker.message, blocker.status);

    const saved = await updateContentPageType(gate.service, page, parsed.data.page_type);
    if (!saved.ok) return contentError(saved.error, saved.status);

    const [fresh, steps, overview] = await Promise.all([
      loadContentPage(gate.service, gate.organisationId, slug),
      loadContentSteps(gate.service, page.id),
      loadContentOverview(gate.service, gate.organisationId),
    ]);
    const data: ContentPagePatchResult = { review: buildReview(fresh ?? page, steps), overview };
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Seitentyp konnte nicht gespeichert werden.", 500);
  }
}

/** „Löschen“: removes the page row (steps cascade); a running job is ended first. */
export async function DELETE(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);

  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const page = await loadContentPage(gate.service, gate.organisationId, slug);
    if (!page) return contentError("Seite nicht gefunden.", 404);
    const result = await deleteContentPage(gate.service, page);
    if (!result.ok) return contentError(result.message, result.status);
    return contentOk({ deleted: true });
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Seite konnte nicht gelöscht werden.", 500);
  }
}
