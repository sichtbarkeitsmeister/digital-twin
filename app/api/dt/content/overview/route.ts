import { contentError, contentOk, gateContentRoute, loadContentReadiness } from "@/lib/dt/content/route-helpers";
import { buildOverview, loadContentPages, syncContentPagesFromStructure } from "@/lib/dt/content/store";

export async function GET(req: Request) {
  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    await syncContentPagesFromStructure(gate.service, gate.organisationId);
    const [{ readiness }, pages] = await Promise.all([
      loadContentReadiness(gate.service, gate.organisationId),
      loadContentPages(gate.service, gate.organisationId),
    ]);
    return contentOk(buildOverview(readiness, pages));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Übersicht konnte nicht geladen werden.";
    return contentError(message, 500);
  }
}
