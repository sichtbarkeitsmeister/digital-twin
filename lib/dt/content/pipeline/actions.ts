/**
 * Human actions on a page: start/continue the run, approve a waiting step, edit a block,
 * rerun from a step with a note, stop the run, reset the page. All state transitions of
 * `dt_content_pages` live here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { EMPTY_CONTENT_FRESHNESS } from "@/lib/dt/content/freshness";
import { loadOrgQuestions } from "@/lib/dt/content/org-questions";
import { readQuestionStop, type ContentHandledQuestion } from "@/lib/dt/content/pipeline/question-stop";
import { customerAnswerNote } from "@/lib/dt/content/pipeline/questions";
import {
  CONTENT_STEP_COUNT,
  CONTENT_STEP_ENDABNAHME,
  CONTENT_STEP_FAKTENCHECK,
  CONTENT_STEP_GEO,
  CONTENT_STEP_LEKTORAT,
  contentStepSkippedByUser,
} from "@/lib/dt/content/pipeline/steps";
import { htmlToMarkdown, replaceBlockText } from "@/lib/dt/content/render";
import {
  CONTENT_SKIPPED_RERUN_MESSAGE,
  rerunStepFor,
  resetContentStepsFrom,
  waitingStepFor,
  type ContentPageRow,
} from "@/lib/dt/content/store";
import { enqueueJob } from "@/lib/jobs/queue";

export const CONTENT_JOB_KIND = "content.page";
const JOB_MAX_ATTEMPTS = 3;

export type ActionResult =
  | { ok: true; jobId: string | null }
  | { ok: false; status: number; message: string };

export const NICHT_BEARBEITEN_REASON =
  "Seitentyp „Nicht bearbeiten“ (Impressum, Datenschutz, Kontakt …) – im Seitenfenster einen anderen Seitentyp wählen, wenn die Seite doch Text bekommen soll";

export function skipReason(page: ContentPageRow): string | null {
  switch (page.state) {
    case "laeuft":
      return "Läuft bereits";
    case "braucht_sie":
      return "Braucht erst Ihre Freigabe";
    case "fertig":
      return page.released ? "Bereits freigegeben" : "Fertig – wartet auf Freigabe";
    default:
      return page.state === "nicht_begonnen" && page.page_type === "nicht_bearbeiten" ? NICHT_BEARBEITEN_REASON : null;
  }
}

export async function enqueuePageJob(
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

/**
 * "Texte erstellen" / "Weiterlaufen lassen": continue at the first unfinished step. An error
 * row goes back to pending; when the editor has switched that step off meanwhile, the runner
 * skips it now instead of trying it again.
 */
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

/**
 * „Freigeben“. On a page that stopped as „Braucht Sie“: accept the text as it is and continue;
 * nothing is filled in or removed.
 *   - At the one stop before the Watermark Entfernung: the stop is done, no question is asked
 *     again; what is left in the text the Endabnahme lists as open points.
 *   - After the Faktencheck for a „grundlegend“ question: that one is accepted, the other
 *     collected questions wait for the stop.
 *   - Pages that stopped under the old rules (questions after the Faktencheck, a placeholder
 *     after a text step, the Endabnahme for a placeholder) work as before: their questions are
 *     cleared and the run goes on; after the Endabnahme, and on a finished page: release.
 */
export async function approveContentStep(
  service: SupabaseClient,
  page: ContentPageRow,
  step: number,
  userId: string,
): Promise<ActionResult> {
  const now = new Date().toISOString();
  if (page.state === "braucht_sie" && step === waitingStepFor(page)) {
    await service
      .from("dt_content_steps")
      .update({ status: "done", approved_by: userId, approved_at: now })
      .eq("page_id", page.id)
      .eq("step", step)
      .neq("status", "skipped");
    if (step === CONTENT_STEP_ENDABNAHME) {
      const { error } = await service
        .from("dt_content_pages")
        .update({ state: "fertig", released: true, released_by: userId, released_at: now, questions: [], job_id: null })
        .eq("id", page.id);
      if (error) return { ok: false, status: 500, message: error.message };
      return { ok: true, jobId: null };
    }
    return enqueuePageJob(service, page, userId, approvalPatch(page, now));
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

/** What „Freigeben“ leaves of the questions (see `approveContentStep`). */
export function approvalPatch(page: Pick<ContentPageRow, "questions" | "question_stop">, now: string): Record<string, unknown> {
  const stop = readQuestionStop(page.question_stop);
  if (stop.status === "waiting" || stop.status === "answered") {
    return { questions: [], question_stop: { ...stop, status: "done", at: now } };
  }
  if (page.questions.some((q) => q.grundlegend)) {
    return { questions: page.questions.filter((q) => !q.grundlegend) };
  }
  return { questions: [] };
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

const STOPPED_BY_USER = "Vom Benutzer gestoppt.";

/**
 * Ends every live job of the page (not only the one the row points to). A worker that is in
 * the middle of a model call finishes that call, then sees the page is no longer `laeuft`
 * and drops the result (`runContentStep`); nothing claims the job again.
 */
async function killPageJobs(service: SupabaseClient, pageId: string): Promise<string | null> {
  const { error } = await service
    .from("jobs")
    .update({
      status: "dead",
      last_error: STOPPED_BY_USER,
      locked_at: null,
      locked_by: null,
      completed_at: new Date().toISOString(),
    })
    .eq("kind", CONTENT_JOB_KIND)
    .eq("dedupe_key", `${CONTENT_JOB_KIND}:${pageId}`)
    .in("status", ["pending", "running"]);
  return error ? `Job konnte nicht gestoppt werden: ${error.message}` : null;
}

/** "Stoppen": end the background job; the page pauses after its last finished step. */
export async function stopContentRun(
  service: SupabaseClient,
  page: ContentPageRow,
  steps: readonly { step: number; status: string }[],
): Promise<ActionResult> {
  if (page.state !== "laeuft") return { ok: false, status: 409, message: "Diese Seite läuft gerade nicht." };
  const killed = await killPageJobs(service, page.id);
  if (killed) return { ok: false, status: 500, message: killed };

  await service
    .from("dt_content_steps")
    .update({ status: "pending", error: null, finished_at: null })
    .eq("page_id", page.id)
    .eq("status", "running");
  const lastDone = steps
    .filter((s) => s.status === "done" || s.status === "skipped")
    .reduce((max, s) => Math.max(max, s.step), 0);
  const { error } = await service
    .from("dt_content_pages")
    .update({ state: "in_arbeit", step: lastDone || null, error: null, job_id: null })
    .eq("id", page.id)
    .eq("state", "laeuft");
  if (error) return { ok: false, status: 500, message: error.message };
  return { ok: true, jobId: null };
}

/** Everything a run produced, gone; name, path and source of the page stay. */
const RESET_PATCH = {
  state: "nicht_begonnen",
  step: null,
  released: false,
  released_by: null,
  released_at: null,
  title: null,
  meta_description: null,
  html: "",
  markdown: "",
  findings: [],
  final_findings: [],
  unresolved: [],
  questions: [],
  notes: [],
  freshness: EMPTY_CONTENT_FRESHNESS,
  question_stop: {},
  error: null,
  job_id: null,
  cost_eur: 0,
  main_keyword: null,
  started_by: null,
} as const;

/**
 * "Zurücksetzen": the page as if it had never been started — text, steps, questions, notes,
 * the Aktualitätsprüfung's updates and send-back, cost. The Excel briefing (keywords,
 * questions, page type) stays; the main keyword from the Excel comes back, one the Analyse
 * found goes.
 */
export async function resetContentPage(service: SupabaseClient, page: ContentPageRow): Promise<ActionResult> {
  const killed = await killPageJobs(service, page.id);
  if (killed) return { ok: false, status: 500, message: killed };
  const { error: stepsError } = await service.from("dt_content_steps").delete().eq("page_id", page.id);
  if (stepsError) return { ok: false, status: 500, message: `Schritte konnten nicht gelöscht werden: ${stepsError.message}` };
  const { error } = await service
    .from("dt_content_pages")
    .update({ ...RESET_PATCH, main_keyword: page.keywords?.main.text ?? null })
    .eq("id", page.id);
  if (error) return { ok: false, status: 500, message: error.message };
  return { ok: true, jobId: null };
}

/**
 * "Löschen": the row and its steps are gone (cascade); live jobs end first. A page from the
 * Seitenstruktur returns with the next upload, a crawl page with the next „übernehmen“.
 */
export async function deleteContentPage(service: SupabaseClient, page: ContentPageRow): Promise<ActionResult> {
  const killed = await killPageJobs(service, page.id);
  if (killed) return { ok: false, status: 500, message: killed };
  const { error } = await service.from("dt_content_pages").delete().eq("id", page.id);
  if (error) return { ok: false, status: 500, message: `Seite konnte nicht gelöscht werden: ${error.message}` };
  return { ok: true, jobId: null };
}

export type ContentToolResetCounts = { pages: number; steps: number; jobs: number; settings: boolean; structure: boolean };

/**
 * „Texte komplett zurücksetzen“ for one organisation: every page (steps cascade), every open
 * content job, and on request the confirmed settings and the uploaded Seitenstruktur — the
 * last one has to go, or the next overview load would recreate the pages from it. The crawl
 * of the website (`dt_site_pages`), avatars and Anbieterfakten stay.
 */
export async function resetContentTool(
  service: SupabaseClient,
  organisationId: string,
  options: { settings: boolean; structure: boolean },
): Promise<{ ok: true; counts: ContentToolResetCounts } | { ok: false; status: number; message: string }> {
  const { data: killed, error: jobsError } = await service
    .from("jobs")
    .update({
      status: "dead",
      last_error: STOPPED_BY_USER,
      locked_at: null,
      locked_by: null,
      completed_at: new Date().toISOString(),
    })
    .eq("kind", CONTENT_JOB_KIND)
    .eq("organisation_id", organisationId)
    .in("status", ["pending", "running"])
    .select("id");
  if (jobsError) return { ok: false, status: 500, message: `Jobs konnten nicht gestoppt werden: ${jobsError.message}` };

  const [{ count: pages, error: pagesError }, { count: steps, error: stepsError }] = await Promise.all([
    service.from("dt_content_pages").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId),
    service.from("dt_content_steps").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId),
  ]);
  if (pagesError) return { ok: false, status: 500, message: `Seiten konnten nicht gezählt werden: ${pagesError.message}` };
  if (stepsError) return { ok: false, status: 500, message: `Schritte konnten nicht gezählt werden: ${stepsError.message}` };

  const { error: deleteError } = await service.from("dt_content_pages").delete().eq("organisation_id", organisationId);
  if (deleteError) return { ok: false, status: 500, message: `Seiten konnten nicht gelöscht werden: ${deleteError.message}` };

  if (options.settings) {
    const { error } = await service.from("dt_content_settings").delete().eq("organisation_id", organisationId);
    if (error) return { ok: false, status: 500, message: `Einstellungen konnten nicht gelöscht werden: ${error.message}` };
  }
  if (options.structure) {
    const { error } = await service.from("dt_website_structures").delete().eq("organisation_id", organisationId);
    if (error) return { ok: false, status: 500, message: `Seitenstruktur konnte nicht gelöscht werden: ${error.message}` };
  }
  return {
    ok: true,
    counts: {
      pages: pages ?? 0,
      steps: steps ?? 0,
      jobs: killed?.length ?? 0,
      settings: options.settings,
      structure: options.structure,
    },
  };
}

/**
 * What a rerun from `step` does to the Aktualitätsprüfung's state: from GEO or earlier it
 * starts over (the next check may send the text back to GEO once more); later only a send-back
 * still waiting for GEO is dropped, since GEO does not run again.
 */
export function freshnessForRerun(page: Pick<ContentPageRow, "freshness">, step: number): ContentPageRow["freshness"] {
  if (step <= CONTENT_STEP_GEO) return EMPTY_CONTENT_FRESHNESS;
  return { ...page.freshness, pending_sections: [] };
}

/**
 * "Mit Anmerkung wiederholen": note becomes a standing instruction, pipeline restarts at `step`.
 * Every row from `step` on goes back to pending (also „skipped“ ones), and the runner applies
 * the page's current `skip_steps` again. Starting AT a step the editor switched off is refused:
 * it would only be skipped, with the note unread.
 */
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
  if (contentStepSkippedByUser(page.skip_steps, step)) {
    return { ok: false, status: 409, message: CONTENT_SKIPPED_RERUN_MESSAGE };
  }
  try {
    await resetContentStepsFrom(service, page.id, step);
  } catch (error) {
    return { ok: false, status: 500, message: error instanceof Error ? error.message : "Schritte konnten nicht zurückgesetzt werden." };
  }
  return enqueuePageJob(service, page, userId, rerunPagePatch(page, step, note));
}

/** What „Mit Anmerkung wiederholen“ from `step` writes on the page. */
export function rerunPagePatch(page: Pick<ContentPageRow, "notes" | "freshness">, step: number, note: string): Record<string, unknown> {
  return {
    notes: [...page.notes, note.trim()].slice(-20),
    step,
    released: false,
    freshness: freshnessForRerun(page, step),
    // From the Lektorat or earlier the page reaches its stop again; from Watermark on it stays passed.
    ...(step <= CONTENT_STEP_LEKTORAT ? { question_stop: {} } : {}),
    ...(step <= CONTENT_STEP_FAKTENCHECK ? { questions: [], findings: [] } : {}),
    ...(step <= CONTENT_STEP_LEKTORAT ? { final_findings: [] } : {}),
    ...(step < CONTENT_STEP_ENDABNAHME ? { unresolved: [] } : {}),
  };
}

export type ContentAnswerInput = { id: string; action: "answer" | "drop"; answer?: string | null };

/**
 * Answers in the page window of a „Braucht Sie“ page under the new rules.
 *   - At the stop before the Watermark Entfernung: the decisions are saved per question
 *     (answer, or „Ohne Angabe weiter“); `submit` („Antworten einarbeiten & weiter“) needs
 *     every page question decided and every company question of this page answered under
 *     „Fragen zum Unternehmen“, then the short pass runs and the run goes on.
 *   - After the Faktencheck for the „grundlegend“ question: the answer becomes a note (a
 *     confirmed fact for every later step) and the run goes on; the other questions wait.
 */
export async function submitContentAnswers(
  service: SupabaseClient,
  page: ContentPageRow,
  input: { answers: readonly ContentAnswerInput[]; submit: boolean },
  userId: string,
  /** The dry run and the tests continue the page without the job queue. */
  deps: { enqueue?: typeof enqueuePageJob } = {},
): Promise<ActionResult & { saved?: number }> {
  const enqueue = deps.enqueue ?? enqueuePageJob;
  if (page.state !== "braucht_sie") return { ok: false, status: 409, message: "Die Seite wartet gerade nicht auf Antworten." };
  const byId = new Map(page.questions.filter((q) => q.id).map((q) => [q.id!, q]));
  for (const a of input.answers) {
    if (!byId.has(a.id)) return { ok: false, status: 404, message: "Diese Frage gehört nicht (mehr) zur Seite. Bitte neu laden." };
    if (a.action === "answer" && !a.answer?.trim()) return { ok: false, status: 400, message: "Bitte eine Antwort eingeben oder „Ohne Angabe weiter“ wählen." };
  }
  const now = new Date().toISOString();
  const stop = readQuestionStop(page.question_stop);

  if (stop.status !== "waiting") {
    // The one early stop: the „grundlegend“ question of the Faktencheck.
    const grundlegend = page.questions.find((q) => q.grundlegend);
    if (!grundlegend || page.step !== CONTENT_STEP_FAKTENCHECK) {
      return { ok: false, status: 409, message: "Diese Seite wartet nach den alten Regeln: bitte „Freigeben“ oder „Abschnitt ändern“." };
    }
    const decision = input.answers.find((a) => a.id === grundlegend.id);
    if (!input.submit || !decision) return { ok: true, jobId: null, saved: 0 };
    await service
      .from("dt_content_steps")
      .update({ status: "done", approved_by: userId, approved_at: now })
      .eq("page_id", page.id)
      .eq("step", CONTENT_STEP_FAKTENCHECK)
      .neq("status", "skipped");
    return enqueue(service, page, userId, {
      questions: page.questions.filter((q) => !q.grundlegend),
      notes: [...page.notes, customerAnswerNote(grundlegend.question, decision.action === "answer" ? decision.answer ?? null : null)].slice(-20),
    });
  }

  const handled = new Map(stop.handled.map((h) => [h.id, h]));
  for (const a of input.answers) {
    const q = byId.get(a.id)!;
    const entry: ContentHandledQuestion = {
      id: a.id,
      question: q.question,
      placeholder: q.placeholder ?? null,
      block_id: q.block_id ?? null,
      excerpt: q.excerpt ?? null,
      scope: q.scope === "firma" ? "firma" : "seite",
      action: a.action,
      answer: a.action === "answer" ? a.answer!.trim().slice(0, 2_000) : null,
      source: "kunde",
    };
    handled.set(a.id, entry);
  }
  const nextStop = { ...stop, handled: [...handled.values()] };
  if (!input.submit) {
    const { error } = await service.from("dt_content_pages").update({ question_stop: nextStop }).eq("id", page.id).eq("state", "braucht_sie");
    if (error) return { ok: false, status: 500, message: error.message };
    return { ok: true, jobId: null, saved: input.answers.length };
  }
  const missing = page.questions.filter((q) => q.id && !handled.has(q.id));
  if (missing.length > 0) {
    return { ok: false, status: 409, message: `Noch ${missing.length} ${missing.length === 1 ? "Frage" : "Fragen"} ohne Antwort: antworten oder „Ohne Angabe weiter“ wählen.` };
  }
  const pool = await loadOrgQuestions(service, page.organisation_id);
  const open = pool.filter((p) => p.status === "open" && p.page_slugs.includes(page.slug));
  if (open.length > 0) {
    return { ok: false, status: 409, message: `Noch ${open.length} ${open.length === 1 ? "Frage" : "Fragen"} zum Unternehmen offen: beantworten oder „Keine Angabe“ wählen.` };
  }
  return enqueue(service, page, userId, { question_stop: { ...nextStop, status: "answered", at: now } });
}
