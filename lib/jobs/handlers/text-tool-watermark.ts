import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import { runWatermarkTextTool, watermarkToolPayloadSchema } from "@/lib/dt/text-tools/watermark";
import { stepBudgetMs } from "@/lib/jobs/schedule";
import { createServiceClient } from "@/lib/supabase/service";

import type { JobHandler } from "../types";

/** Chunked and resumable like step 8 of Texte: a short remainder of the tick is enough to start. */
const NEEDED_MS = 45_000;

/**
 * Watermark tool run (kind: text-tool.watermark). Payload: `WatermarkToolPayload` (the
 * uploaded blocks and the person's notes). The progress lives on the job row's `result`
 * (`{ progress }`) after every answered chunk and when the tick runs out of budget; the
 * handler then reschedules without a failed attempt and the next tick resumes. A
 * retryable model error (rate limit, overload, timeout) is tried again by the runner,
 * from the saved progress; everything else ends the job with the message visible.
 */
export const textToolWatermarkHandler: JobHandler = async ({ job, deadline }) => {
  const parsed = watermarkToolPayloadSchema.safeParse(job.payload);
  if (!parsed.success) return { ok: false, error: "Ungültige Job-Daten.", retryable: false };

  const budget = stepBudgetMs(Date.now(), deadline ?? Date.now() + NEEDED_MS, NEEDED_MS);
  // Keep the stored progress: a reschedule writes `result` back to the row.
  if (budget == null) return { ok: true, reschedule: true, result: job.result ?? undefined };

  const service = createServiceClient();
  try {
    const outcome = await runWatermarkTextTool(service, parsed.data, {
      timeoutMs: budget,
      previous: job.result,
      saveProgress: async (state) => {
        const { error } = await service.from("jobs").update({ result: state }).eq("id", job.id).eq("status", "running");
        if (error) console.warn("[text-tool.watermark] progress not stored:", error.message);
      },
    });
    if (outcome.state === "partial") {
      return { ok: true, reschedule: true, result: { progress: outcome.progress } };
    }
    return { ok: true, result: outcome.result as unknown as Record<string, unknown> };
  } catch (error) {
    if (error instanceof ContentLlmError) return { ok: false, error: error.message, retryable: error.retryable };
    return { ok: false, error: error instanceof Error ? error.message : String(error), retryable: false };
  }
};
