import { deleteContentPage } from "@/lib/dt/content/pipeline/actions";
import { contentError, contentOk, gateContentRoute, isValidContentSlug } from "@/lib/dt/content/route-helpers";
import { loadContentPage } from "@/lib/dt/content/store";

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
