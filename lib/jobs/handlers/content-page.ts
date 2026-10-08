import type { SupabaseClient } from "@supabase/supabase-js";

import { interruptedStepMessage } from "@/lib/dt/content/job-state";
import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import { markContentStepError, markContentStepRetry, runContentStep } from "@/lib/dt/content/pipeline/run-step";
import { CONTENT_STEP_COUNT, contentStepDefinition, nextContentStep } from "@/lib/dt/content/pipeline/steps";
import { loadContentPageById, loadContentSteps, type ContentPageRow } from "@/lib/dt/content/store";
import { stepBudgetMs } from "@/lib/jobs/schedule";
import { createServiceClient } from "@/lib/supabase/service";

import type { JobHandler, JobHandlerResult } from "../types";

/** A full page needs most of the worker budget. Shorter steps can start later in the tick. */
const LONG_STEP_MS = 150_000;
const SHORT_STEP_MS = 45_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Content pipeline for one page (kind: content.page).
 * Payload: { pageId: uuid, organisationId: uuid }
 *
 * Runs every step that still fits in this wake-up. Stopping after one step and waiting
 * for the next cron tick left the page on "Gliederung läuft" whenever that tick was cut
 * off before Rohtext was claimed. The job ends when the page needs a person (blocking
 * questions after the Faktencheck, release after the Endabnahme) or a step fails for good.
 *
 * Every failure, including a failed read, is reported to the runner as a failed attempt:
 * a job that quietly „succeeds“ while the page still says `laeuft` is what left pages
 * stuck. Transient errors are retried up to `max_attempts`; the last attempt pauses the
 * page with the error visible (`in_arbeit`), so „Weiterlaufen lassen“ can continue it.
 */
export const contentPageHandler: JobHandler = async ({ job, deadline }) => {
  const pageId = (job.payload as { pageId?: string }).pageId;
  if (!pageId) return { ok: false, error: "Missing pageId", retryable: false };

  const lastAttempt = job.attempts + 1 >= job.max_attempts;
  let service: SupabaseClient;
  try {
    service = createServiceClient();
  } catch (error) {
    return { ok: false, error: errorMessage(error), retryable: !lastAttempt };
  }

  const limit = deadline ?? Date.now() + LONG_STEP_MS;
  let continued: JobHandlerResult | null = null;
  let page: ContentPageRow | null = null;
  let next: number | null = null;

  try {
    for (let ran = 0; ran < CONTENT_STEP_COUNT; ran++) {
      page = await loadContentPageById(service, pageId);
      if (!page) return { ok: true, result: { skipped: "page_missing" } };
      if (page.state !== "laeuft") return { ok: true, result: { skipped: page.state } };
      if (page.job_id !== job.id) {
        // Only one pending/running job per page exists (dedupe index), so whatever the row
        // points to is finished. Adopt the page instead of leaving it „läuft“ without an owner.
        await service.from("dt_content_pages").update({ job_id: job.id }).eq("id", pageId).eq("state", "laeuft");
        page = { ...page, job_id: job.id };
      }

      const steps = await loadContentSteps(service, pageId);
      next = nextContentStep(steps);
      if (!next) {
        const { error } = await service
          .from("dt_content_pages")
          .update({ state: "fertig", job_id: null })
          .eq("id", pageId);
        if (error) throw new Error(`Seite konnte nicht abgeschlossen werden: ${error.message}`);
        return { ok: true, result: { finished: true } };
      }

      const interrupted = steps.find((s) => s.step === next && s.status === "running");
      if (interrupted) {
        const message = interruptedStepMessage(next, interrupted.started_at, job);
        if (lastAttempt) {
          await markContentStepError(service, page, next, message);
          return { ok: false, error: message, retryable: false };
        }
        await markContentStepRetry(service, page, next, message);
        return { ok: false, error: message, retryable: true };
      }

      const needed = contentStepDefinition(next)?.writesText ? LONG_STEP_MS : SHORT_STEP_MS;
      const budget = stepBudgetMs(Date.now(), limit, needed);
      if (budget == null) {
        return continued ?? { ok: true, reschedule: true, result: { step: next, deferred: true } };
      }

      try {
        const outcome = await runContentStep(service, page, steps, next, budget);
        if (outcome.halted) {
          return {
            ok: true,
            result: { step: next, halted: true, discarded: outcome.discarded ?? false, model: outcome.model, costEur: outcome.costEur },
          };
        }
        continued = { ok: true, reschedule: true, result: { step: next, model: outcome.model, costEur: outcome.costEur } };
      } catch (error) {
        const message = errorMessage(error);
        // Database hiccups while saving are worth another try; a rejected key or a cut-off
        // answer (ContentLlmError, retryable=false) is not.
        const retryable = error instanceof ContentLlmError ? error.retryable : true;
        if (!retryable || lastAttempt) {
          await markContentStepError(service, page, next, message);
          return { ok: false, error: message, retryable: false };
        }
        await markContentStepRetry(service, page, next, message);
        return { ok: false, error: message, retryable: true };
      }
    }
  } catch (error) {
    // A read failed (database, missing migration). Never report success here: the page
    // would stay „läuft“ with a finished job.
    const message = errorMessage(error);
    console.error("[content.page] step loop failed", error);
    if (lastAttempt && page && next) {
      await markContentStepError(service, page, next, message).catch(() => undefined);
    }
    return { ok: false, error: message, retryable: !lastAttempt };
  }

  return continued ?? { ok: true, reschedule: true, result: { deferred: true } };
};
