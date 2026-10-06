/**
 * Human actions on a page: start/continue the run, approve a waiting step, edit a block,
 * rerun from a step with a note. All state transitions of `dt_content_pages` live here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { CONTENT_STEP_ENDABNAHME, CONTENT_STEP_FAKTENCHECK, CONTENT_STEP_COUNT } from "@/lib/dt/content/pipeline/steps";
import { htmlToMarkdown, replaceBlockText } from "@/lib/dt/content/render";
import { rerunStepFor, type ContentPageRow } from "@/lib/dt/content/store";
import { enqueueJob } from "@/lib/jobs/queue";

export const CONTENT_JOB_KIND = "content.page";
const JOB_MAX_ATTEMPTS = 3;

export type ActionResult =
  | { ok: true; jobId: string | null }
  | { ok: false; status: number; message: string };

export function skipReason(page: ContentPageRow): string | null {
  switch (page.state) {
    case "laeuft":
      return "Läuft bereits";
    case "braucht_sie":
      return "Braucht erst Ihre Freigabe";
    case "fertig":
      return page.released ? "Bereits freigegeben" : "Fertig – wartet auf Freigabe";
    default:
      return null;
  }
}

async function enqueuePageJob(
  service: SupabaseClient,
  page: ContentPageRow,
  userId: string | null,
  extraPatch: Record<string, unknown> = {},
): Promise<ActionResult> {
  const dedupeKey = `${CONTENT_JOB_KIND}:${page.id}`;
  const queued = await enqueueJob({
    kind: CONTENT_JOB_KIND,
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
      .eq("kind", CONTENT_JOB_KIND)
      .eq("dedupe_key", dedupeKey)
      .in("status", ["pending", "running"])
      .maybeSingle();
    jobId = (data?.id as string | undefined) ?? null;
  }

  const { error } = await service
    .from("dt_content_pages")
    .update({
      state: "laeuft",
      error: null,
      job_id: jobId,
      ...(userId ? { started_by: userId } : {}),
      ...extraPatch,
    })
    .eq("id", page.id);
  if (error) return { ok: false, status: 500, message: error.message };
  return { ok: true, jobId };
}

async function resetStepsFrom(service: SupabaseClient, pageId: string, fromStep: number): Promise<void> {
  await service
    .from("dt_content_steps")
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
      approved_by: null,
      approved_at: null,
    })
    .eq("page_id", pageId)
    .gte("step", fromStep);
}

/** "Texte erstellen" / "Weiterlaufen lassen": continue at the first unfinished step. */
export async function startContentRun(
  service: SupabaseClient,
  page: ContentPageRow,
  userId: string,
): Promise<ActionResult> {
  const reason = skipReason(page);
  if (reason) return { ok: false, status: 409, message: reason };

  await service
    .from("dt_content_steps")
    .update({ status: "pending", error: null })
    .eq("page_id", page.id)
    .in("status", ["error", "running"]);
  return enqueuePageJob(service, page, userId);
}

/** Step 4: accept the text despite open questions and continue. Step 8: release the page. */
export async function approveContentStep(
  service: SupabaseClient,
  page: ContentPageRow,
  step: number,
  userId: string,
): Promise<ActionResult> {
  const now = new Date().toISOString();
  if (step === CONTENT_STEP_FAKTENCHECK && page.state === "braucht_sie") {
    await service
      .from("dt_content_steps")
      .update({ status: "done", approved_by: userId, approved_at: now })
      .eq("page_id", page.id)
      .eq("step", step);
    return enqueuePageJob(service, page, userId, { questions: [] });
  }
  if (step === CONTENT_STEP_ENDABNAHME && page.state === "fertig" && !page.released) {
    await service
      .from("dt_content_steps")
      .update({ status: "done", approved_by: userId, approved_at: now })
      .eq("page_id", page.id)
      .eq("step", step);
    const { error } = await service
      .from("dt_content_pages")
      .update({ released: true, released_by: userId, released_at: now })
      .eq("id", page.id);
    if (error) return { ok: false, status: 500, message: error.message };
    return { ok: true, jobId: null };
  }
  return { ok: false, status: 409, message: "Dieser Schritt wartet gerade nicht auf eine Freigabe." };
}

function canEdit(page: ContentPageRow): boolean {
  return (
    Boolean(page.html) &&
    (page.state === "braucht_sie" || page.state === "in_arbeit" || (page.state === "fertig" && !page.released))
  );
}

/** "Abschnitt ändern": replace one block's text; findings for that block are considered handled. */
export async function editContentBlock(
  service: SupabaseClient,
  page: ContentPageRow,
  blockId: string,
  text: string,
): Promise<ActionResult> {
  if (!canEdit(page)) {
    return { ok: false, status: 409, message: "Der Text kann in diesem Zustand nicht geändert werden." };
  }
  const html = replaceBlockText(page.html, blockId, text);
  if (html == null) return { ok: false, status: 404, message: "Abschnitt nicht gefunden." };

  const drop = <T extends { block_id?: string | null }>(list: T[]) => list.filter((f) => f.block_id !== blockId);
  const { error } = await service
    .from("dt_content_pages")
    .update({
      html,
      markdown: htmlToMarkdown(html),
      findings: drop(page.findings),
      final_findings: drop(page.final_findings),
      unresolved: drop(page.unresolved),
      questions: drop(page.questions),
    })
    .eq("id", page.id);
  if (error) return { ok: false, status: 500, message: error.message };
  return { ok: true, jobId: null };
}

/** "Mit Anmerkung wiederholen": note becomes a standing instruction, pipeline restarts at `step`. */
export async function rerunContentStep(
  service: SupabaseClient,
  page: ContentPageRow,
  step: number,
  note: string,
  userId: string,
): Promise<ActionResult> {
  if (page.state === "laeuft" || page.state === "nicht_begonnen" || (page.state === "fertig" && page.released)) {
    return { ok: false, status: 409, message: skipReason(page) ?? "Die Seite wurde noch nicht gestartet." };
  }
  const maxStep = Math.max(rerunStepFor(page), page.step ?? 1);
  if (step < 1 || step > CONTENT_STEP_COUNT || step > maxStep) {
    return { ok: false, status: 400, message: `Schritt ${step} kann hier nicht wiederholt werden.` };
  }
  await resetStepsFrom(service, page.id, step);
  return enqueuePageJob(service, page, userId, {
    notes: [...page.notes, note.trim()].slice(-20),
    step,
    released: false,
    ...(step <= CONTENT_STEP_FAKTENCHECK ? { questions: [], findings: [] } : {}),
    ...(step <= 7 ? { final_findings: [], unresolved: [] } : {}),
  });
}
