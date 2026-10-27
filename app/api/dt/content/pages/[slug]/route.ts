import { loadContentOverview } from "@/lib/dt/content/overview";
import { parseContentPagePatch } from "@/lib/dt/content/page-patch";
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
  planContentSkipSteps,
  updateContentPageType,
  updateContentSkipSteps,
} from "@/lib/dt/content/store";
import type { ContentPagePatchResult } from "@/lib/dt/content/types";

/**
 * „Seitentyp“ in the table and in the drawer, and „Schritte“ in the drawer (`skip_steps`, the
 * whole list of steps switched off). Every page: the Excel type and the crawl guess are
 * suggestions the editor overrides by hand. Neither changes while the page runs (409).
 */
export async function PATCH(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);

  const parsed = parseContentPagePatch(await readJsonBody(req));
  if (!parsed.ok) return contentError(parsed.message, 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const page = await loadContentPage(gate.service, gate.organisationId, slug);
    if (!page) return contentError("Seite nicht gefunden.", 404);
    const { page_type: pageType, skip_steps: skipSteps } = parsed.data;
    // Everything is checked before anything is written.
    if (pageType !== undefined) {
      const blocker = contentPageTypeChangeBlocker(page);
      if (blocker) return contentError(blocker.message, blocker.status);
    }
    if (skipSteps !== undefined) {
      const plan = planContentSkipSteps(page, skipSteps);
      if (!plan.ok) return contentError(plan.message, plan.status);
    }

    if (pageType !== undefined) {
      const saved = await updateContentPageType(gate.service, page, pageType);
      if (!saved.ok) return contentError(saved.error, saved.status);
    }
    if (skipSteps !== undefined) {
      const saved = await updateContentSkipSteps(gate.service, page, skipSteps);
      if (!saved.ok) return contentError(saved.error, saved.status);
    }

    const [fresh, steps, overview] = await Promise.all([
      loadContentPage(gate.service, gate.organisationId, slug),
      loadContentSteps(gate.service, page.id),
      loadContentOverview(gate.service, gate.organisationId),
    ]);
    const data: ContentPagePatchResult = { review: buildReview(fresh ?? page, steps), overview };
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Änderung konnte nicht gespeichert werden.", 500);
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
