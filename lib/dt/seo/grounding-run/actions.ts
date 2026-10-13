/**
 * Human actions on a Grounding draft: start or continue the run, answer the customer
 * questions, skip them, stop, reset. All `run_state` transitions of `dt_grounding_pages`
 * live here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { groundingRunNotes } from "@/lib/dt/seo/grounding-run/store";
import { GROUNDING_STEP_FAKTENCHECK } from "@/lib/dt/seo/grounding-run/steps";
import { enqueueJob } from "@/lib/jobs/queue";
import type { DtGroundingPageRow } from "@/lib/dt/types";

export const GROUNDING_JOB_KIND = "grounding.page";
const JOB_MAX_ATTEMPTS = 3;

export type GroundingActionResult =
  | { ok: true; jobId: string | null }
  | { ok: false; status: number; message: string };

export function groundingSkipReason(page: Pick<DtGroundingPageRow, "run_state">): string | null {
  switch (page.run_state) {
    case "laeuft":
      return "Der Entwurf läuft bereits.";
    case "braucht_sie":
      return "Der Entwurf wartet auf Ihre Antworten.";
    case "fertig":
      return "Der Entwurf ist fertig. Für eine neue Fassung „Neu erstellen“ wählen.";
    default:
      return null;
  }
}

async function enqueuePageJob(
  service: SupabaseClient,
  page: DtGroundingPageRow,
  userId: string | null,
  extraPatch: Record<string, unknown> = {},
): Promise<GroundingActionResult> {
  const dedupeKey = `${GROUNDING_JOB_KIND}:${page.id}`;
  const queued = await enqueueJob({
    kind: GROUNDING_JOB_KIND,
    organisationId: page.organisation_id,
    payload: { pageId: page.id, organisationId: page.organisation_id },
    dedupeKey,
    maxAttempts: JOB_MAX_ATTEMPTS,
  });
  if (!queued.ok) return { ok: false, status: 500, message: `Job konnte nicht angelegt werden: ${queued.error}` };

  let jobId = queued.jobId;
  if (!jobId) {
    const { data } = await service
      .from("jobs")
      .select("id")
      .eq("kind", GROUNDING_JOB_KIND)
      .eq("dedupe_key", dedupeKey)
      .in("status", ["pending", "running"])
      .maybeSingle();
    jobId = (data?.id as string | undefined) ?? null;
  }

  const { error } = await service
    .from("dt_grounding_pages")
    .update({
      run_state: "laeuft",
      run_error: null,
      job_id: jobId,
      ...(userId ? { started_by: userId } : {}),
      ...extraPatch,
    })
    .eq("id", page.id);
  if (error) return { ok: false, status: 500, message: error.message };
  return { ok: true, jobId };
}

async function killPageJobs(service: SupabaseClient, pageId: string): Promise<string | null> {
  const { error } = await service
    .from("jobs")
    .update({ status: "failed", last_error: "Vom Nutzer beendet.", locked_at: null, locked_by: null, completed_at: new Date().toISOString() })
    .eq("kind", GROUNDING_JOB_KIND)
    .eq("dedupe_key", `${GROUNDING_JOB_KIND}:${pageId}`)
    .in("status", ["pending", "running"]);
  return error ? `Laufende Jobs konnten nicht beendet werden: ${error.message}` : null;
}

async function resetStepsFrom(service: SupabaseClient, pageId: string, fromStep: number): Promise<void> {
  await service
    .from("dt_grounding_steps")
    .update({
      status: "pending",
      output: null,
      error: null,
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      cost_eur: 0,
      started_at: null,
      finished_at: null,
    })
    .eq("page_id", pageId)
    .gte("step", fromStep);
}

/** „Entwurf erstellen“ / „Weiterlaufen lassen“: continue at the first unfinished step. */
export async function startGroundingRun(
  service: SupabaseClient,
  page: DtGroundingPageRow,
  userId: string | null,
): Promise<GroundingActionResult> {
  const reason = groundingSkipReason(page);
  if (reason) return { ok: false, status: 409, message: reason };
  await service
    .from("dt_grounding_steps")
    .update({ status: "pending", error: null })
    .eq("page_id", page.id)
    .in("status", ["error", "running"]);
  return enqueuePageJob(service, page, userId);
}

/**
 * „Antworten senden“: the answers become editorial notes, the Faktencheck counts as done
 * and the run continues with „Seite bauen“ (which reads the notes). Without text the
 * questions are skipped and the affected facts are left out.
 */
export async function answerGroundingQuestions(
  service: SupabaseClient,
  page: DtGroundingPageRow,
  answers: string,
  userId: string | null,
): Promise<GroundingActionResult> {
  if (page.run_state !== "braucht_sie") {
    return { ok: false, status: 409, message: "Dieser Entwurf wartet gerade nicht auf Antworten." };
  }
  const note = answers.trim();
  const notes = note ? [...groundingRunNotes(page), note].slice(-20) : groundingRunNotes(page);
  await service
    .from("dt_grounding_steps")
    .update({ status: "done" })
    .eq("page_id", page.id)
    .eq("step", GROUNDING_STEP_FAKTENCHECK);
  return enqueuePageJob(service, page, userId, { run_notes: notes, questions: [] });
}

export async function stopGroundingRun(
  service: SupabaseClient,
  page: DtGroundingPageRow,
  steps: readonly { step: number; status: string }[],
): Promise<GroundingActionResult> {
  if (page.run_state !== "laeuft") return { ok: false, status: 409, message: "Dieser Entwurf läuft gerade nicht." };
  const killed = await killPageJobs(service, page.id);
  if (killed) return { ok: false, status: 500, message: killed };
  await service
    .from("dt_grounding_steps")
    .update({ status: "pending", error: null, finished_at: null })
    .eq("page_id", page.id)
    .eq("status", "running");
  const lastDone = steps.filter((s) => s.status === "done" || s.status === "skipped").reduce((max, s) => Math.max(max, s.step), 0);
  const { error } = await service
    .from("dt_grounding_pages")
    .update({ run_state: "in_arbeit", run_step: lastDone || null, run_error: null, job_id: null })
    .eq("id", page.id)
    .eq("run_state", "laeuft");
  if (error) return { ok: false, status: 500, message: error.message };
  return { ok: true, jobId: null };
}

/** „Neu erstellen“ / „Entwurf verwerfen“: the draft as if never started; the page row and its live data stay. */
export async function resetGroundingRun(
  service: SupabaseClient,
  page: DtGroundingPageRow,
  options: { keepNotes?: boolean; restart?: boolean; userId?: string } = {},
): Promise<GroundingActionResult> {
  const killed = await killPageJobs(service, page.id);
  if (killed) return { ok: false, status: 500, message: killed };
  const { error: stepsError } = await service.from("dt_grounding_steps").delete().eq("page_id", page.id);
  if (stepsError) return { ok: false, status: 500, message: `Schritte konnten nicht gelöscht werden: ${stepsError.message}` };
  const patch = {
    run_state: "nicht_begonnen",
    run_step: null,
    run_error: null,
    job_id: null,
    facts: null,
    questions: [],
    findings: [],
    run_notes: options.keepNotes ? groundingRunNotes(page) : [],
    html: null,
    title: null,
    meta_description: null,
    cost_eur: 0,
  };
  const { error } = await service.from("dt_grounding_pages").update(patch).eq("id", page.id);
  if (error) return { ok: false, status: 500, message: error.message };
  if (!options.restart) return { ok: true, jobId: null };
  return enqueuePageJob(service, { ...page, ...patch, run_state: "nicht_begonnen" } as DtGroundingPageRow, options.userId ?? null);
}

/** „Mit Anmerkung neu bauen“: keep the facts, rebuild the page from step 3 with the note. */
export async function rebuildGroundingPage(
  service: SupabaseClient,
  page: DtGroundingPageRow,
  note: string,
  userId: string,
): Promise<GroundingActionResult> {
  if (page.run_state === "laeuft" || page.run_state === "nicht_begonnen" || !page.facts) {
    return { ok: false, status: 409, message: groundingSkipReason(page) ?? "Es gibt noch keine Faktenbasis." };
  }
  const killed = await killPageJobs(service, page.id);
  if (killed) return { ok: false, status: 500, message: killed };
  await resetStepsFrom(service, page.id, GROUNDING_STEP_FAKTENCHECK + 1);
  await service
    .from("dt_grounding_steps")
    .update({ status: "done" })
    .eq("page_id", page.id)
    .eq("step", GROUNDING_STEP_FAKTENCHECK)
    .eq("status", "waiting");
  const notes = note.trim() ? [...groundingRunNotes(page), note.trim()].slice(-20) : groundingRunNotes(page);
  return enqueuePageJob(service, page, userId, { run_notes: notes, questions: [], findings: [] });
}
