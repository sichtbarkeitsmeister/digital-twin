import { findDuplicateContent } from "@/lib/dt/content/duplicates";
import { contentError, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";
import { loadContentTexts } from "@/lib/dt/content/store";

/**
 * „Texte vergleichen“: what the finished texts of the organisation repeat between pages. Code only
 * (no model, no cost); reads the texts as they are stored right now.
 */
export async function GET(req: Request) {
  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;
  try {
    const texts = await loadContentTexts(gate.service, gate.organisationId);
    return contentOk(findDuplicateContent(texts));
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Texte konnten nicht verglichen werden.", 500);
  }
}
