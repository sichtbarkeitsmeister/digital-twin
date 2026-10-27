import type { SupabaseClient } from "@supabase/supabase-js";

import { interruptedStepMessage } from "@/lib/dt/content/job-state";
import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import {
  markContentStepError,
  markContentStepRetry,
  runContentStep,
  skipContentStep,
} from "@/lib/dt/content/pipeline/run-step";
import {
  CONTENT_STEP_AKTUALITAET,
  CONTENT_STEP_COUNT,
  contentStepDefinition,
  nextContentStep,
  skipsContentStep,
} from "@/lib/dt/content/pipeline/steps";
import { loadContentPageById, loadContentSteps, type ContentPageRow } from "@/lib/dt/content/store";
import { stepBudgetMs } from "@/lib/jobs/schedule";
import { createServiceClient } from "@/lib/supabase/service";

import type { JobHandler, JobHandlerResult, JobRow } from "../types";

/** A full page needs most of the worker budget. Shorter steps can start later in the tick. */
const LONG_STEP_MS = 150_000;
const SHORT_STEP_MS = 45_000;
/** A skipped SEO fetches the live page (at most 15 s); every other skip is a few writes. */
const LIVE_TEXT_MS = 20_000;

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

  let service: SupabaseClient;
  try {
    service = createServiceClient();
  } catch (error) {
    return { ok: false, error: errorMessage(error), retryable: job.attempts + 1 < job.max_attempts };
  }
  return runContentPageSteps({ service, job, pageId, deadline });
};

/** The step runners; the test swaps them for stubs (no model, no network). */
export type ContentPageStepRunners = {
  runStep: typeof runContentStep;
  skipStep: typeof skipContentStep;
};

/**
 * The step loop of one wake-up. A step the editor switched off for the page
 * (`skip_steps`) is marked „skipped“ here, before the time budget is checked: a skip makes
 * no model call (SEO: one fetch of the live page) and must not wait for a tick that has
 * 150 s left, nor count as a step that needs one. It goes through the same failure handling
 * as a step (a failed live-text import pauses the page) and the loop goes on.
 */
export async function runContentPageSteps(input: {
  service: SupabaseClient;
  job: Pick<JobRow, "id" | "attempts" | "max_attempts">;
  pageId: string;
  deadline?: number;
  runners?: Partial<ContentPageStepRunners>;
}): Promise<JobHandlerResult> {
  const { service, job, pageId } = input;
  const runStep = input.runners?.runStep ?? runContentStep;
  const skipStep = input.runners?.skipStep ?? skipContentStep;
  const lastAttempt = job.attempts + 1 >= job.max_attempts;
  const limit = input.deadline ?? Date.now() + LONG_STEP_MS;
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

      // Switched off by the editor and still to run (pending, error, no row): marked in passing.
      const skip = skipsContentStep(page.skip_steps, next, steps.find((s) => s.step === next));

      // Watermark Entfernung works in chunks and resumes where it stopped, so a short remainder is
      // enough for it. The Aktualitätsprüfung is long: web research plus the whole text; when the
      // budget runs out between the two it hands back `partial` and resumes with its saved research.
      let budget: number | undefined;
      if (skip) {
        const needed = contentStepDefinition(next)?.key === "seo" ? LIVE_TEXT_MS : 0;
        if (Date.now() + needed >= limit) {
          return continued ?? { ok: true, reschedule: true, result: { step: next, deferred: true } };
        }
      } else {
        const def = contentStepDefinition(next);
        const needed =
          def?.provider === "xai"
            ? SHORT_STEP_MS
            : def?.step === CONTENT_STEP_AKTUALITAET || def?.writesText
              ? LONG_STEP_MS
              : SHORT_STEP_MS;
        const stepBudget = stepBudgetMs(Date.now(), limit, needed);
        if (stepBudget == null) {
          return continued ?? { ok: true, reschedule: true, result: { step: next, deferred: true } };
        }
        budget = stepBudget;
      }

      try {
        const outcome = skip ? await skipStep(service, page, steps, next) : await runStep(service, page, steps, next, budget);
        if (outcome.halted) {
          return {
            ok: true,
            result: {
              step: next,
              halted: true,
              discarded: outcome.discarded ?? false,
              ...(skip ? { skippedByUser: true } : {}),
              model: outcome.model,
              costEur: outcome.costEur,
            },
          };
        }
        if (outcome.partial) {
          // Progress is saved; the next loop turn or the next tick continues the same step.
          continued = { ok: true, reschedule: true, result: { step: next, partial: true, model: outcome.model } };
          continue;
        }
        continued = {
          ok: true,
          reschedule: true,
          result: skip ? { step: next, skippedByUser: true } : { step: next, model: outcome.model, costEur: outcome.costEur },
        };
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
}
