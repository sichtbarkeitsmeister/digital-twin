import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import { markContentStepError, runContentStep } from "@/lib/dt/content/pipeline/run-step";
import { CONTENT_STEP_COUNT, contentStepDefinition, nextContentStep } from "@/lib/dt/content/pipeline/steps";
import { loadContentPageById, loadContentSteps } from "@/lib/dt/content/store";
import { stepBudgetMs } from "@/lib/jobs/schedule";
import { createServiceClient } from "@/lib/supabase/service";

import type { JobHandler, JobHandlerResult } from "../types";

/** A full page needs most of the worker budget. Shorter steps can start later in the tick. */
const LONG_STEP_MS = 150_000;
const SHORT_STEP_MS = 45_000;

/**
 * Content pipeline for one page (kind: content.page).
 * Payload: { pageId: uuid, organisationId: uuid }
 *
 * Runs every step that still fits in this wake-up. Stopping after one step and waiting
 * for the next cron tick left the page on "Gliederung läuft" whenever that tick was cut
 * off before Rohtext was claimed. The job ends when the page needs a person (blocking
 * questions after the Faktencheck, release after the Endabnahme) or a step fails for good.
 */
export const contentPageHandler: JobHandler = async ({ job, deadline }) => {
  const pageId = (job.payload as { pageId?: string }).pageId;
  if (!pageId) return { ok: false, error: "Missing pageId", retryable: false };

  const service = createServiceClient();
  const limit = deadline ?? Date.now() + LONG_STEP_MS;
  let continued: JobHandlerResult | null = null;

  for (let ran = 0; ran < CONTENT_STEP_COUNT; ran++) {
    const page = await loadContentPageById(service, pageId);
    if (!page) return { ok: true, result: { skipped: "page_missing" } };
    if (page.job_id !== job.id) return { ok: true, result: { skipped: "stale_job" } };
    if (page.state !== "laeuft") return { ok: true, result: { skipped: page.state } };

    const steps = await loadContentSteps(service, pageId);
    const next = nextContentStep(steps);
    if (!next) {
      await service.from("dt_content_pages").update({ state: "fertig", job_id: null }).eq("id", pageId);
      return { ok: true, result: { finished: true } };
    }

    const needed = contentStepDefinition(next)?.writesText ? LONG_STEP_MS : SHORT_STEP_MS;
    const budget = stepBudgetMs(Date.now(), limit, needed);
    if (budget == null) {
      return continued ?? { ok: true, reschedule: true, result: { step: next, deferred: true } };
    }

    try {
      const outcome = await runContentStep(service, page, steps, next, budget);
      if (outcome.halted) {
        return { ok: true, result: { step: next, halted: true, model: outcome.model, costEur: outcome.costEur } };
      }
      continued = { ok: true, reschedule: true, result: { step: next, model: outcome.model, costEur: outcome.costEur } };
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
  }

  return continued ?? { ok: true, reschedule: true, result: { deferred: true } };
};
