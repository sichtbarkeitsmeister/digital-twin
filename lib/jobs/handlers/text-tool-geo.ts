import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import { geoToolPayloadSchema, runGeoTextTool } from "@/lib/dt/text-tools/geo";
import { stepBudgetMs } from "@/lib/jobs/schedule";
import { createServiceClient } from "@/lib/supabase/service";

import type { JobHandler } from "../types";

/** A GEO rewrite is one long Claude call, like a writing step of the pipeline. */
const NEEDED_MS = 150_000;

/**
 * GEO tool run (kind: text-tool.geo). Payload: `GeoToolPayload` (the uploaded blocks and
 * the person's inputs); the result lands on the job row, the status route reads it from
 * there. One attempt per tick; a retryable model error (rate limit, overload, timeout) is
 * tried again by the runner, everything else ends the job with the message visible.
 */
export const textToolGeoHandler: JobHandler = async ({ job, deadline }) => {
  const parsed = geoToolPayloadSchema.safeParse(job.payload);
  if (!parsed.success) return { ok: false, error: "Ungültige Job-Daten.", retryable: false };

  const budget = stepBudgetMs(Date.now(), deadline ?? Date.now() + NEEDED_MS, NEEDED_MS);
  if (budget == null) return { ok: true, reschedule: true };

  try {
    const result = await runGeoTextTool(createServiceClient(), parsed.data, { timeoutMs: budget });
    return { ok: true, result: result as unknown as Record<string, unknown> };
  } catch (error) {
    if (error instanceof ContentLlmError) return { ok: false, error: error.message, retryable: error.retryable };
    return { ok: false, error: error instanceof Error ? error.message : String(error), retryable: false };
  }
};
