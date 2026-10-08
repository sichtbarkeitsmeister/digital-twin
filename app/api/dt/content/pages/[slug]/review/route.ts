import { reconcileContentPages } from "@/lib/dt/content/pipeline/health";
import { contentError, contentOk, gateContentRoute, isValidContentSlug } from "@/lib/dt/content/route-helpers";
import { buildReview, loadContentPage, loadContentSteps } from "@/lib/dt/content/store";

export const maxDuration = 300;

export async function GET(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);

  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const page = await loadContentPage(gate.service, gate.organisationId, slug);
    if (!page) return contentError("Seite nicht gefunden.", 404);
    const { pages, verdicts } = await reconcileContentPages(gate.service, [page]);
    const steps = await loadContentSteps(gate.service, page.id);
    return contentOk(buildReview(pages[0] ?? page, steps, verdicts.get(page.id) ?? null));
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Seite konnte nicht geladen werden.", 500);
  }
}
