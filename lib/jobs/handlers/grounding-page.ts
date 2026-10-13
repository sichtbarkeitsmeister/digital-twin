import type { SupabaseClient } from "@supabase/supabase-js";

import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import { DT_GROUNDING_PAGE_SELECT } from "@/lib/dt/seo/grounding-pages";
import { markGroundingStepError, markGroundingStepRetry, runGroundingStep } from "@/lib/dt/seo/grounding-run/run-step";
import { loadGroundingSteps } from "@/lib/dt/seo/grounding-run/store";
import {
  GROUNDING_STEP_COUNT,
  groundingStepDefinition,
  groundingStepName,
  nextGroundingStep,
} from "@/lib/dt/seo/grounding-run/steps";
import { stepBudgetMs } from "@/lib/jobs/schedule";
import { createServiceClient } from "@/lib/supabase/service";
import type { DtGroundingPageRow } from "@/lib/dt/types";

import type { JobHandler, JobHandlerResult } from "../types";

const LONG_STEP_MS = 150_000;
const SHORT_STEP_MS = 60_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadPage(service: SupabaseClient, pageId: string): Promise<DtGroundingPageRow | null> {
  const { data, error } = await service.from("dt_grounding_pages").select(DT_GROUNDING_PAGE_SELECT).eq("id", pageId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DtGroundingPageRow | null) ?? null;
}

function interruptedMessage(step: number, startedAt: string | null, job: { attempts: number; max_attempts: number }): string {
  const label = `Schritt ${step}${groundingStepName(step) ? ` (${groundingStepName(step)})` : ""}`;
  const since = startedAt ? Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60_000)) : null;
  const ago = since != null ? ` (gestartet vor ${since} Min.)` : "";
  const attempt = job.attempts + 1;
  if (attempt >= job.max_attempts) {
    return `${label} wurde ${attempt}-mal abgebrochen, bevor die KI fertig war${ago} – vermutlich ein Zeitlimit. Mit „Weiterlaufen lassen“ noch einmal versuchen.`;
  }
  return `${label} wurde unterbrochen, bevor die KI fertig war${ago}. Versuch ${attempt} von ${job.max_attempts} – wird gleich wiederholt.`;
}

/**
 * Grounding agent for one page (kind: grounding.page). Payload: { pageId, organisationId }.
 * Runs every step that still fits in this wake-up; ends when the page needs a person
 * (questions after the Faktencheck, the human review after the Endprüfung) or a step fails.
 */
export const groundingPageHandler: JobHandler = async ({ job, deadline }) => {
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
  let page: DtGroundingPageRow | null = null;
  let next: number | null = null;

  try {
    for (let ran = 0; ran < GROUNDING_STEP_COUNT; ran++) {
      page = await loadPage(service, pageId);
      if (!page) return { ok: true, result: { skipped: "page_missing" } };
      if (page.run_state !== "laeuft") return { ok: true, result: { skipped: page.run_state } };
      if (page.job_id !== job.id) {
        await service.from("dt_grounding_pages").update({ job_id: job.id }).eq("id", pageId).eq("run_state", "laeuft");
        page = { ...page, job_id: job.id };
      }

      const steps = await loadGroundingSteps(service, pageId);
      next = nextGroundingStep(steps);
      if (!next) {
        const { error } = await service.from("dt_grounding_pages").update({ run_state: "fertig", job_id: null }).eq("id", pageId);
        if (error) throw new Error(`Seite konnte nicht abgeschlossen werden: ${error.message}`);
        return { ok: true, result: { finished: true } };
      }

      const interrupted = steps.find((s) => s.step === next && s.status === "running");
      if (interrupted) {
        const message = interruptedMessage(next, interrupted.started_at, job);
        if (lastAttempt) {
          await markGroundingStepError(service, page, next, message);
          return { ok: false, error: message, retryable: false };
        }
        await markGroundingStepRetry(service, page, next, message);
        return { ok: false, error: message, retryable: true };
      }

      const def = groundingStepDefinition(next);
      const budget = stepBudgetMs(Date.now(), limit, def?.long ? LONG_STEP_MS : SHORT_STEP_MS);
      if (budget == null) {
        return continued ?? { ok: true, reschedule: true, result: { step: next, deferred: true } };
      }

      try {
        const outcome = await runGroundingStep(service, page, steps, next, budget);
        if (outcome.halted) {
          return { ok: true, result: { step: next, halted: true, discarded: outcome.discarded ?? false, model: outcome.model, costEur: outcome.costEur } };
        }
        continued = { ok: true, reschedule: true, result: { step: next, model: outcome.model, costEur: outcome.costEur } };
      } catch (error) {
        const message = errorMessage(error);
        const retryable = error instanceof ContentLlmError ? error.retryable : true;
        if (!retryable || lastAttempt) {
          await markGroundingStepError(service, page, next, message);
          return { ok: false, error: message, retryable: false };
        }
        await markGroundingStepRetry(service, page, next, message);
        return { ok: false, error: message, retryable: true };
      }
    }
  } catch (error) {
    const message = errorMessage(error);
    console.error("[grounding.page] step loop failed", error);
    if (lastAttempt && page && next) {
      await markGroundingStepError(service, page, next, message).catch(() => undefined);
    }
    return { ok: false, error: message, retryable: !lastAttempt };
  }

  return continued ?? { ok: true, reschedule: true, result: { deferred: true } };
};
