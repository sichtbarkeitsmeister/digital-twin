import { z } from "zod";

import { ContentLlmError, llmErrorMessage } from "@/lib/dt/content/pipeline/llm";
import { REVISE_INSTRUCTION_MAX } from "@/lib/dt/content/pipeline/revise";
import { previewRevision } from "@/lib/dt/content/pipeline/revise-actions";
import { contentError, contentOk, gateContentRoute, isValidContentSlug, readJsonBody } from "@/lib/dt/content/route-helpers";
import { loadContentPage, loadContentSteps } from "@/lib/dt/content/store";

export const maxDuration = 300;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  block_id: z.string().min(1).max(80),
  instruction: z.string().max(REVISE_INSTRUCTION_MAX).optional().nullable(),
  info: z.string().max(REVISE_INSTRUCTION_MAX).optional().nullable(),
  finding_key: z.string().max(4_000).optional().nullable(),
});

/**
 * „Abschnitt überarbeiten lassen“, „Vorschlag umsetzen“, „Eigene Angabe“: a preview of one
 * revised Abschnitt (before and after). Nothing in the text changes until `…/revise/apply`.
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
    const result = await previewRevision(gate.service, page, steps, parsed.data, gate.userId);
    if (!result.ok) {
      const reasons = result.reasons?.length ? ` (${result.reasons.join("; ")})` : "";
      return contentError(`${result.message}${reasons}`, result.status);
    }
    return contentOk(result);
  } catch (error) {
    if (error instanceof ContentLlmError) return contentError(error.message, error.retryable ? 503 : 400);
    return contentError(llmErrorMessage(error), 502);
  }
}
