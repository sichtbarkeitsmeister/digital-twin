import type { SupabaseClient } from "@supabase/supabase-js";

import { interruptedStepMessage } from "@/lib/dt/content/job-state";
import { CONTENT_STOP_REASON_TIMEOUT, CONTENT_TIMEOUT_FINAL_MESSAGE, ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import { readPageFacts } from "@/lib/dt/content/pipeline/page-facts-model";
import { questionStopDue } from "@/lib/dt/content/pipeline/question-stop";
import {
  markContentStepError,
  markContentStepRetry,
  runContentStep,
  runQuestionStop,
  skipContentStep,
  stepFailureDetail,
} from "@/lib/dt/content/pipeline/run-step";
import {
  CONTENT_STEP_AKTUALITAET,
  CONTENT_STEP_ANALYSE,
  CONTENT_STEP_COUNT,
  CONTENT_STEP_ENDABNAHME,
  CONTENT_STEP_FAKTENCHECK,
  contentStepDefinition,
  nextContentStep,
  skipsContentStep,
} from "@/lib/dt/content/pipeline/steps";
import { loadContentPageById, loadContentSteps, type ContentPageRow, type ContentStepRow } from "@/lib/dt/content/store";
import { JOB_WORKER_BUDGET_MS, stepBudgetMs } from "@/lib/jobs/schedule";
import { createServiceClient } from "@/lib/supabase/service";

import type { JobHandler, JobHandlerResult, JobRow } from "../types";

/** A full page needs most of the worker budget. Shorter steps can start later in the tick. */
const LONG_STEP_MS = 150_000;
/**
 * A Claude step that returns the whole page text (SEO, GEO, Hormozi, Vermenschlichung,
 * Lektorat) starts only with a nearly full tick. Started with 150 s left it got about 135 s,
 * some 7,300 tokens at the measured 54 per second: an Unterseite of 2,600 words did not fit,
 * the time limit cut the stream and the stub went on as the text (10.11.). With 200 s left the
 * call has at least 185 s, about 10,000 tokens; a first step of a tick gets up to 225 s.
 */
export const FULL_TEXT_STEP_MS = 200_000;
const SHORT_STEP_MS = 45_000;
/**
 * Steps that write no text but whose answer grows with the page: the Faktencheck's findings and
 * questions (up to 12,000 tokens) and the Endabnahme's open points (up to 8,000). Started with
 * a short remainder they would run into the time limit; they wait for a long slot instead.
 */
const LONG_CHECK_STEPS: ReadonlySet<number> = new Set([CONTENT_STEP_FAKTENCHECK, CONTENT_STEP_ENDABNAHME]);
/** A skipped SEO fetches the live page (at most 15 s); every other skip is a few writes. */
const LIVE_TEXT_MS = 20_000;
/** The stop before the Watermark Entfernung: at most one short call on a few Abschnitte. */
const QUESTION_STOP_MS = 90_000;

/**
 * Did this step's previous attempt end at the time limit? Then its row waits to run again
 * (`pending`) with that reason on it (`markContentStepRetry`); a second time-out is final
 * (`CONTENT_TIMEOUT_MAX_RETRIES`). A step started again by hand („Weiterlaufen lassen“ after
 * the error) has an `error` row and gets its one repetition anew.
 */
export function stepTimedOutBefore(row: Pick<ContentStepRow, "status" | "error" | "stop_reason"> | null | undefined): boolean {
  if (!row || row.status !== "pending") return false;
  return row.stop_reason === CONTENT_STOP_REASON_TIMEOUT || /Zeitlimit erreicht/i.test(row.error ?? "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What this worker may do with a page whose row points at another job (`job_id`). */
export type ContentPageOwnership =
  /** The page's job is finished or gone: this job takes the page over. */
  | "adopt"
  /** This job was ended meanwhile („Stoppen“, „Zurücksetzen“): leave the page alone. */
  | "job_ended"
  /** Another live job runs the page (stopped and started again): leave it to that one. */
  | "other_job";

/**
 * Whose page is it? „Stoppen“ ends the job in the database, but its worker stays inside the
 * model call until the answer comes back. When the page was started again meanwhile, a new job
 * owns it; the old worker used to save its answer, point the page back at itself and go on,
 * and the overview then paused the page as „Abgebrochen“ because that job was ended. Now only
 * a page whose job is finished or gone is adopted.
 */
export async function contentPageOwnership(
  service: SupabaseClient,
  jobId: string,
  pageJobId: string | null,
): Promise<ContentPageOwnership> {
  const ids = [jobId, ...(pageJobId ? [pageJobId] : [])];
  const { data, error } = await service.from("jobs").select("id, status").in("id", ids);
  if (error) throw new Error(`Jobs konnten nicht geladen werden: ${error.message}`);
  const status = new Map(((data ?? []) as { id: string; status: string }[]).map((row) => [row.id, row.status]));
  const live = (id: string | null) => id != null && (status.get(id) === "pending" || status.get(id) === "running");
  if (!live(jobId)) return "job_ended";
  if (live(pageJobId)) return "other_job";
  return "adopt";
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
  questionStop: typeof runQuestionStop;
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
  const questionStop = input.runners?.questionStop ?? runQuestionStop;
  const lastAttempt = job.attempts + 1 >= job.max_attempts;
  // Without a deadline (tests, a direct call) the loop has one full worker tick.
  const limit = input.deadline ?? Date.now() + JOB_WORKER_BUDGET_MS;
  let continued: JobHandlerResult | null = null;
  let page: ContentPageRow | null = null;
  let next: number | null = null;

  try {
    // One turn per step, plus the Faktenauszug before the Analyse and the stop for questions.
    for (let ran = 0; ran < CONTENT_STEP_COUNT + 3; ran++) {
      page = await loadContentPageById(service, pageId);
      if (!page) return { ok: true, result: { skipped: "page_missing" } };
      if (page.state !== "laeuft") return { ok: true, result: { skipped: page.state } };
      if (page.job_id !== job.id) {
        // A page whose job is finished is adopted instead of being left „läuft“ without an owner.
        // A page another live job runs, or a job that was stopped meanwhile, is left alone.
        const ownership = await contentPageOwnership(service, job.id, page.job_id);
        if (ownership !== "adopt") return { ok: true, result: { skipped: ownership } };
        const { data: adopted, error: adoptError } = await service
          .from("dt_content_pages")
          .update({ job_id: job.id })
          .eq("id", pageId)
          .eq("state", "laeuft")
          .select("id");
        if (adoptError) throw new Error(`Seite konnte nicht übernommen werden: ${adoptError.message}`);
        if (!adopted?.length) return { ok: true, result: { skipped: "not_running" } };
        page = { ...page, job_id: job.id };
      }

      const steps = await loadContentSteps(service, pageId);
      next = nextContentStep(steps);
      if (!next) {
        const { error } = await service
          .from("dt_content_pages")
          .update({ state: "fertig", job_id: null })
          .eq("id", pageId)
          .eq("job_id", job.id);
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

      // The page's one stop for questions comes before the Watermark Entfernung (or, with that
      // switched off, before the Endabnahme): ask once, or work the known answers in, then go on.
      if (questionStopDue(page.question_stop, steps, next)) {
        // Deciding is a few reads and writes; only a model call for the answers needs a long slot,
        // and the stop itself says so (`deferred`) before it changes anything.
        const stopBudget = Math.min(QUESTION_STOP_MS, Math.max(0, limit - Date.now()));
        try {
          const outcome = await questionStop(service, page, steps, stopBudget);
          if (outcome.deferred) {
            return continued ?? { ok: true, reschedule: true, result: { step: next, deferred: true, questionStop: "pass" } };
          }
          if (outcome.halted) {
            return { ok: true, result: { step: next, halted: true, questionStop: outcome.action, discarded: outcome.discarded ?? false } };
          }
          continued = { ok: true, reschedule: true, result: { questionStop: outcome.action, costEur: outcome.costEur } };
          continue;
        } catch (error) {
          const message = errorMessage(error);
          const retryable = error instanceof ContentLlmError ? error.retryable : true;
          if (!retryable || lastAttempt) {
            await markContentStepError(service, page, next, `Antworten einarbeiten: ${message}`);
            return { ok: false, error: message, retryable: false };
          }
          return { ok: false, error: message, retryable: true };
        }
      }

      // Switched off by the editor and still to run (pending, error, no row): marked in passing.
      const skip = skipsContentStep(page.skip_steps, next, steps.find((s) => s.step === next));

      // Watermark Entfernung works in chunks and resumes where it stopped, so a short remainder is
      // enough for it. The Aktualitätsprüfung is long: web research plus the whole text; when the
      // budget runs out between the two it hands back `partial` and resumes with its saved research.
      // Faktencheck and Endabnahme write no text, but their lists can be as long (LONG_CHECK_STEPS).
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
            : def?.step === CONTENT_STEP_ANALYSE && !readPageFacts(steps.find((s) => s.step === next)?.output)
              ? // The Faktenauszug reads all conversations before the Analyse: a long call.
                FULL_TEXT_STEP_MS
              : def?.writesText && def.step !== CONTENT_STEP_AKTUALITAET
              ? FULL_TEXT_STEP_MS
              : def?.step === CONTENT_STEP_AKTUALITAET || (def != null && LONG_CHECK_STEPS.has(def.step))
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
        const detail = stepFailureDetail(error);
        // The time limit: one repetition, then the step fails for everyone to see.
        const timedOut = detail.stopReason === CONTENT_STOP_REASON_TIMEOUT;
        const timedOutBefore = timedOut && stepTimedOutBefore(steps.find((s) => s.step === next));
        if (!retryable || lastAttempt || timedOutBefore) {
          const final = timedOut ? CONTENT_TIMEOUT_FINAL_MESSAGE : message;
          await markContentStepError(service, page, next, final, detail);
          return { ok: false, error: final, retryable: false };
        }
        await markContentStepRetry(service, page, next, message, detail);
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
