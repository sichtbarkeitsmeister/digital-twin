import { NextResponse } from "next/server";

import { contentError, contentOk, gateContentAgencyRoute, readJsonBody } from "@/lib/dt/content/route-helpers";
import { XAI_MISSING_KEY_MESSAGE, resolveXaiApiKey } from "@/lib/dt/content/pipeline/xai";
import { WATERMARK_TOOL_USAGE_MODE, rephraseWatermarkChunk, watermarkChunkRequestSchema } from "@/lib/dt/text-tools/watermark";

/** One Grok call takes seconds; the slowest fallback model is cut at two minutes. */
export const maxDuration = 300;

/**
 * Watermark tool, one request per chunk: the chunk's sections → the same sections with new
 * body text, from one Grok call through the runner of Texte step 8. Failures answer with
 * `{ ok: false, message, retryable, slowModels }` so the browser can retry or stop.
 */
export async function POST(req: Request) {
  const gated = await gateContentAgencyRoute();
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  if (!resolveXaiApiKey()) return contentError(XAI_MISSING_KEY_MESSAGE, 503);

  const parsed = watermarkChunkRequestSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Abschnittsgruppe.", 400);

  const result = await rephraseWatermarkChunk(parsed.data.blocks, {
    slowModels: parsed.data.slowModels,
    onUsage: async (usage) => {
      // No organisation, so no usage event row (it requires one); the server log keeps the cost.
      console.info(
        `[${WATERMARK_TOOL_USAGE_MODE}] usage`,
        JSON.stringify({ userId: gate.userId, model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costEur: usage.costEur }),
      );
    },
  });
  if (result.ok) return contentOk(result.value);
  return NextResponse.json({ ok: false, ...result.error }, { status: result.error.retryable ? 503 : 502 });
}
