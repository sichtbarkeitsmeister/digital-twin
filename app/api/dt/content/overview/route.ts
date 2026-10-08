import { loadContentOverview } from "@/lib/dt/content/overview";
import { contentError, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";

/** Repairing a stale page may poke the job worker after the response (`after()`). */
export const maxDuration = 300;

export async function GET(req: Request) {
  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    return contentOk(await loadContentOverview(gate.service, gate.organisationId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Übersicht konnte nicht geladen werden.";
    return contentError(message, 500);
  }
}
