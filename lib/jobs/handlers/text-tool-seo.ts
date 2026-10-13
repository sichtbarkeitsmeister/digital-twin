import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import { runSeoTextTool, seoToolPayloadSchema } from "@/lib/dt/text-tools/seo";
import { stepBudgetMs } from "@/lib/jobs/schedule";
import { createServiceClient } from "@/lib/supabase/service";

import type { JobHandler } from "../types";

/** Two Claude calls at most (Analyse, then the page text), each like a writing step of the pipeline. */
const NEEDED_MS = 150_000;

/**
 * SEO tool run (kind: text-tool.seo). Payload: `SeoToolPayload` (the briefing form and the
 * uploaded material). Step 1 „Analyse“ runs first unless an Analyse was pasted; its result
 * lands on the job row (`result.analyse`) right away. With too little budget left for the
 * SEO call the handler reschedules without a failed attempt and the next tick writes the
 * text from the stored Analyse. A retryable model error (rate limit, overload, timeout) is
 * tried again by the runner, from the stored Analyse; everything else ends the job with the
 * message visible.
 */
export const textToolSeoHandler: JobHandler = async ({ job, deadline }) => {
  const parsed = seoToolPayloadSchema.safeParse(job.payload);
  if (!parsed.success) return { ok: false, error: "Ungültige Job-Daten.", retryable: false };

  const budget = stepBudgetMs(Date.now(), deadline ?? Date.now() + NEEDED_MS, NEEDED_MS);
  // Keep the stored Analyse: a reschedule writes `result` back to the row.
  if (budget == null) return { ok: true, reschedule: true, result: job.result ?? undefined };

  const service = createServiceClient();
  try {
    const outcome = await runSeoTextTool(service, parsed.data, {
      timeoutMs: budget,
      previous: job.result,
      saveProgress: async (progress) => {
        const { error } = await service.from("jobs").update({ result: progress }).eq("id", job.id).eq("status", "running");
        if (error) console.warn("[text-tool.seo] analyse not stored:", error.message);
      },
    });
    if (outcome.state === "partial") {
      return { ok: true, reschedule: true, result: outcome.progress as unknown as Record<string, unknown> };
    }
    return { ok: true, result: outcome.result as unknown as Record<string, unknown> };
  } catch (error) {
    if (error instanceof ContentLlmError) return { ok: false, error: error.message, retryable: error.retryable };
    return { ok: false, error: error instanceof Error ? error.message : String(error), retryable: false };
  }
};
