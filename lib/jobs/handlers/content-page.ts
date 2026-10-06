import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import { markContentStepError, runContentStep } from "@/lib/dt/content/pipeline/run-step";
import { CONTENT_STEPS } from "@/lib/dt/content/pipeline/steps";
import { loadContentPageById, loadContentSteps } from "@/lib/dt/content/store";
import { createServiceClient } from "@/lib/supabase/service";

import type { JobHandler } from "../types";

/**
 * Content pipeline for one page (kind: content.page).
 * Payload: { pageId: uuid, organisationId: uuid }
 *
 * One step per run, then `reschedule` so every step gets a fresh lock and the next cron tick
 * (≤ 30 s) continues. The job ends when the page needs a person (blocking questions after the
 * Faktencheck, release after the Endabnahme) or when a step fails for good.
 */
export const contentPageHandler: JobHandler = async ({ job }) => {
  const pageId = (job.payload as { pageId?: string }).pageId;
  if (!pageId) return { ok: false, error: "Missing pageId", retryable: false };

  const service = createServiceClient();
  const page = await loadContentPageById(service, pageId);
  if (!page) return { ok: true, result: { skipped: "page_missing" } };
  if (page.job_id !== job.id) return { ok: true, result: { skipped: "stale_job" } };
  if (page.state !== "laeuft") return { ok: true, result: { skipped: page.state } };

  const steps = await loadContentSteps(service, pageId);
  const next = CONTENT_STEPS.find((def) => {
    const row = steps.find((s) => s.step === def.step);
    return !row || (row.status !== "done" && row.status !== "skipped");
  })?.step;

  if (!next) {
    await service
      .from("dt_content_pages")
      .update({ state: "fertig", job_id: null })
      .eq("id", pageId);
    return { ok: true, result: { finished: true } };
  }

  try {
    const outcome = await runContentStep(service, page, steps, next);
    if (outcome.halted) {
      return { ok: true, result: { step: next, halted: true, model: outcome.model, costEur: outcome.costEur } };
    }
    return { ok: true, reschedule: true, result: { step: next, model: outcome.model, costEur: outcome.costEur } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = error instanceof ContentLlmError ? error.retryable : false;
    const lastAttempt = job.attempts + 1 >= job.max_attempts;
    if (!retryable || lastAttempt) {
      await markContentStepError(service, page, next, message);
      return { ok: false, error: message, retryable: false };
    }
    return { ok: false, error: message, retryable: true };
  }
};
