import { z } from "zod";

import { resetContentPage, stopContentRun } from "@/lib/dt/content/pipeline/actions";
import {
  contentError,
  contentOk,
  gateContentRoute,
  isValidContentSlug,
  readJsonBody,
} from "@/lib/dt/content/route-helpers";
import { buildReview, loadContentPage, loadContentSteps } from "@/lib/dt/content/store";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  mode: z.enum(["stop", "reset"]),
});

/**
 * „Stoppen“ ends the background job and pauses the page after its last finished step;
 * „Zurücksetzen“ wipes the page back to „Nicht begonnen“. Answers with the fresh review.
 */
export async function POST(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);

  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const page = await loadContentPage(gate.service, gate.organisationId, slug);
    if (!page) return contentError("Seite nicht gefunden.", 404);
    const steps = await loadContentSteps(gate.service, page.id);

    const result =
      parsed.data.mode === "stop"
        ? await stopContentRun(gate.service, page, steps)
        : await resetContentPage(gate.service, page);
    if (!result.ok) return contentError(result.message, result.status);

    const [fresh, freshSteps] = await Promise.all([
      loadContentPage(gate.service, gate.organisationId, slug),
      loadContentSteps(gate.service, page.id),
    ]);
    return contentOk(buildReview(fresh ?? page, freshSteps));
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Aktion fehlgeschlagen.", 500);
  }
}
