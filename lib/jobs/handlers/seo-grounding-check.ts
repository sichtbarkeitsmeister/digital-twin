import type { SupabaseClient } from "@supabase/supabase-js";

import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import { GROUNDING_CHECK_STEPS, GROUNDING_CHECK_STEP_MS, GroundingCheckError } from "@/lib/dt/seo/grounding-check/steps";
import { RUN_JOB_COLUMNS, loadRunRow } from "@/lib/dt/seo/grounding-check/store";
import { stepBudgetMs } from "@/lib/jobs/schedule";
import { createServiceClient } from "@/lib/supabase/service";
import type { DtGroundingRunRow } from "@/lib/dt/types";

import type { JobHandler, JobHandlerResult } from "../types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryable(error: unknown): boolean {
  if (error instanceof GroundingCheckError || error instanceof ContentLlmError) return error.retryable;
  return true;
}

async function failRun(service: SupabaseClient, runId: string, message: string) {
  await service
    .from("dt_grounding_runs")
    .update({ status: "failed", error: message.slice(0, 500), finished_at: new Date().toISOString(), job_id: null })
    .eq("id", runId)
    .eq("status", "running");
}

/**
 * Grounding check of one organisation (kind: seo.grounding_check).
 * Payload: { organisationId, runId, trigger }. Runs crawl → extract → compare → generate,
 * as many steps as fit this wake-up; each step is stored on the run row, the rest follows
 * in the next tick. Ends with a draft for human review, „up to date“, or failed.
 */
export const seoGroundingCheckHandler: JobHandler = async ({ job, deadline }) => {
  const runId = (job.payload as { runId?: string }).runId;
  if (!runId) return { ok: false, error: "Missing runId", retryable: false };
  const lastAttempt = job.attempts + 1 >= job.max_attempts;
  const service = createServiceClient();
  const limit = deadline ?? Date.now() + GROUNDING_CHECK_STEP_MS.extract;
  let continued: JobHandlerResult | null = null;

  for (let i = 0; i < 4; i++) {
    let run: DtGroundingRunRow | null;
    try {
      run = await loadRunRow(service, runId, RUN_JOB_COLUMNS);
    } catch (error) {
      return { ok: false, error: errorMessage(error), retryable: !lastAttempt };
    }
    if (!run) return { ok: true, result: { skipped: "run_missing" } };
    if (run.status !== "running") return { ok: true, result: { skipped: run.status } };
    if (run.job_id !== job.id) {
      await service.from("dt_grounding_runs").update({ job_id: job.id }).eq("id", runId).eq("status", "running");
    }
    if (run.step === "done") {
      await failRun(service, runId, "Die Prüfung endete ohne Ergebnis.");
      return { ok: true, result: { finished: true } };
    }

    const step = run.step;
    const budget = stepBudgetMs(Date.now(), limit, GROUNDING_CHECK_STEP_MS[step]);
    if (budget == null) return continued ?? { ok: true, reschedule: true, result: { step, deferred: true } };

    try {
      const patch = await GROUNDING_CHECK_STEPS[step]({ service, run, deadline: Date.now() + budget, timeoutMs: budget });
      const { data, error } = await service
        .from("dt_grounding_runs")
        .update({ ...patch, job_id: job.id })
        .eq("id", runId)
        .eq("status", "running")
        .select("status")
        .maybeSingle();
      if (error) throw new GroundingCheckError(`Ergebnis konnte nicht gespeichert werden: ${error.message}`, true);
      if (!data) return { ok: true, result: { step, discarded: true } };
      if (data.status !== "running") return { ok: true, result: { step, status: data.status } };
      continued = { ok: true, reschedule: true, result: { step } };
    } catch (error) {
      const message = errorMessage(error);
      if (!isRetryable(error) || lastAttempt) {
        await failRun(service, runId, message);
        return { ok: false, error: message, retryable: false };
      }
      await service.from("dt_grounding_runs").update({ error: message.slice(0, 500) }).eq("id", runId).eq("status", "running");
      return { ok: false, error: message, retryable: true };
    }
  }
  return continued ?? { ok: true, reschedule: true };
};
