import { contentError, contentOk, gateContentRoute, isValidContentSlug } from "@/lib/dt/content/route-helpers";
import { buildReview, loadContentPage, loadContentSteps } from "@/lib/dt/content/store";

export async function GET(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);

  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const page = await loadContentPage(gate.service, gate.organisationId, slug);
  if (!page) return contentError("Seite nicht gefunden.", 404);
  const steps = await loadContentSteps(gate.service, page.id);
  return contentOk(buildReview(page, steps));
}
