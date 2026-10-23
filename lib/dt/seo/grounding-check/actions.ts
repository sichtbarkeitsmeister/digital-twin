/**
 * What people do with a Grounding check: start it, edit or switch facts in the draft,
 * approve or reject it, mark the files as uploaded. Shared by the API routes and the
 * scheduled sweep. Nothing here publishes to the customer's website.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { GROUNDING_REVIEWER, GROUNDING_STANDARD_VERSION } from "@/lib/dt/prompts/grounding-page-standard";
import { DT_GROUNDING_PAGE_SELECT, buildGroundingPageUpdate } from "@/lib/dt/seo/grounding-pages";
import {
  type FactToggle,
  type FaqToggle,
  applyFactToggles,
  berlinDay,
  berlinMonth,
  parseGroundingFactModel,
} from "@/lib/dt/seo/grounding-check/fact-model";
import { hasType, parseJsonLdFromHtml } from "@/lib/dt/seo/grounding-check/jsonld";
import { renderGroundingHtml, sourceTitlesFor } from "@/lib/dt/seo/grounding-check/render-html";
import { renderGroundingLlmsTxt } from "@/lib/dt/seo/grounding-check/render-llms";
import { checklistComplete } from "@/lib/dt/seo/grounding-check/review";
import { applyReviewToHtml, applyReviewToLlmsTxt } from "@/lib/dt/seo/grounding-check/review-stamp";
import { RUN_DETAIL_COLUMNS, groundingRunsDbErrorMessage } from "@/lib/dt/seo/grounding-check/store";
import { EMPTY_HINTS, type CrawledUrlEntry, type GroundingHints, type ReviewChecklist } from "@/lib/dt/seo/grounding-check/types";
import { type GroundingValidation, validateGroundingDraft } from "@/lib/dt/seo/grounding-check/validate";
import { enqueueJob } from "@/lib/jobs/queue";
import type { DtGroundingPageRow, DtGroundingRunRow, DtGroundingRunTrigger } from "@/lib/dt/types";

export const GROUNDING_CHECK_JOB_KIND = "seo.grounding_check";

export type ActionResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string; validation?: GroundingValidation };

const fail = (status: number, message: string, validation?: GroundingValidation): ActionResult<never> => ({ ok: false, status, message, validation });

async function updateRun(service: SupabaseClient, runId: string, patch: Record<string, unknown>, expectStatus?: string): Promise<DtGroundingRunRow> {
  let query = service.from("dt_grounding_runs").update(patch).eq("id", runId);
  if (expectStatus) query = query.eq("status", expectStatus);
  const { data, error } = await query.select(RUN_DETAIL_COLUMNS).maybeSingle();
  if (error) throw new Error(groundingRunsDbErrorMessage(error, "Prüfung konnte nicht gespeichert werden"));
  if (!data) throw new Error("Die Prüfung hat sich inzwischen geändert. Bitte neu laden.");
  return data as unknown as DtGroundingRunRow;
}

/** Create the run row and queue its job. One running check per organisation (DB index). */
export async function startGroundingCheck(
  service: SupabaseClient,
  input: { organisationId: string; trigger: DtGroundingRunTrigger; userId: string | null; runAfter?: Date },
): Promise<ActionResult<DtGroundingRunRow>> {
  const { data, error } = await service
    .from("dt_grounding_runs")
    .insert({ organisation_id: input.organisationId, trigger: input.trigger, status: "running", step: "crawl", created_by: input.userId })
    .select(RUN_DETAIL_COLUMNS)
    .maybeSingle();
  if (error || !data) {
    if (error?.code === "23505") return fail(409, "Für diese Organisation läuft bereits eine Prüfung.");
    return fail(500, error ? groundingRunsDbErrorMessage(error, "Prüfung konnte nicht angelegt werden") : "Prüfung konnte nicht angelegt werden.");
  }
  const run = data as unknown as DtGroundingRunRow;
  const job = await enqueueJob({
    kind: GROUNDING_CHECK_JOB_KIND,
    organisationId: input.organisationId,
    payload: { organisationId: input.organisationId, runId: run.id, trigger: input.trigger },
    dedupeKey: `grounding-check:${run.id}`,
    runAfter: input.runAfter,
    maxAttempts: 3,
  });
  if (!job.ok || !job.jobId) {
    const message = job.ok ? "Der Hintergrund-Job wurde nicht angelegt." : `Der Hintergrund-Job konnte nicht angelegt werden: ${job.error}`;
    await service.from("dt_grounding_runs").update({ status: "failed", error: message, finished_at: new Date().toISOString() }).eq("id", run.id);
    return fail(500, message);
  }
  const { data: withJob } = await service.from("dt_grounding_runs").update({ job_id: job.jobId }).eq("id", run.id).select(RUN_DETAIL_COLUMNS).maybeSingle();
  return { ok: true, value: (withJob as unknown as DtGroundingRunRow | null) ?? { ...run, job_id: job.jobId } };
}

/** Earlier drafts are set aside when a new check is started on purpose. */
export async function rejectOpenDrafts(service: SupabaseClient, organisationId: string, note: string): Promise<number> {
  const { data } = await service
    .from("dt_grounding_runs")
    .update({ status: "rejected", review_note: note, reviewed_at: new Date().toISOString() })
    .eq("organisation_id", organisationId)
    .eq("status", "draft")
    .select("id");
  return (data ?? []).length;
}

function hintsOf(run: DtGroundingRunRow): GroundingHints {
  return { ...EMPTY_HINTS, ...((run.hints as Partial<GroundingHints> | null) ?? {}) };
}

function isGenerated(run: DtGroundingRunRow): boolean {
  return run.decision === "create" || run.decision === "update_required";
}

/** Edit the files by hand, or switch facts and FAQ on/off (re-renders both files). */
export async function saveDraft(
  service: SupabaseClient,
  run: DtGroundingRunRow,
  input: { draftHtml?: string; draftLlmsTxt?: string; facts?: FactToggle[]; faq?: FaqToggle[] },
): Promise<ActionResult<DtGroundingRunRow>> {
  if (run.status !== "draft") return fail(409, "Nur ein Entwurf lässt sich ändern.");
  const patch: Record<string, unknown> = {};
  let html = run.draft_html;
  let llmsTxt = run.draft_llms_txt;
  let model = parseGroundingFactModel(run.fact_model);

  if ((input.facts?.length ?? 0) > 0 || (input.faq?.length ?? 0) > 0) {
    const render = hintsOf(run).render;
    if (!isGenerated(run) || !model || !render) {
      return fail(400, "Fakten lassen sich nur in einem neu erstellten Entwurf umschalten.");
    }
    model = applyFactToggles(model, { facts: input.facts, faq: input.faq });
    const crawled = Array.isArray(run.crawled_urls) ? (run.crawled_urls as CrawledUrlEntry[]) : [];
    html = renderGroundingHtml({ model, createdDay: render.createdDay, modifiedDay: render.modifiedDay, sourceTitles: sourceTitlesFor(model, crawled) });
    llmsTxt = renderGroundingLlmsTxt({ model, llmsUrl: render.llmsUrl, createdDay: render.createdDay, modifiedDay: render.modifiedDay, month: render.modifiedDay.slice(0, 7) });
    patch.fact_model = model;
  }
  if (input.draftHtml !== undefined) html = input.draftHtml;
  if (input.draftLlmsTxt !== undefined) llmsTxt = input.draftLlmsTxt;

  patch.draft_html = html;
  patch.draft_llms_txt = llmsTxt;
  patch.validation = validateGroundingDraft({ html, llmsTxt, model, reviewed: false, generated: isGenerated(run) });
  return { ok: true, value: await updateRun(service, run.id, patch, "draft") };
}

/**
 * Approve: stamp the documented review (Sichtbarkeitsmeister GmbH, today) into both files
 * and check them again. Errors block the approval; nothing is saved then.
 */
export async function approveDraft(
  service: SupabaseClient,
  run: DtGroundingRunRow,
  input: { userId: string; reviewerName: string; checklist: ReviewChecklist; note?: string | null; now?: Date },
): Promise<ActionResult<DtGroundingRunRow>> {
  if (run.status !== "draft") return fail(409, "Nur ein Entwurf lässt sich freigeben.");
  if (!checklistComplete(input.checklist)) return fail(400, "Bitte alle sechs Prüfpunkte bestätigen.");
  const reviewerName = input.reviewerName.trim();
  if (!reviewerName) return fail(400, "Bitte den Namen der prüfenden Person eintragen.");
  if (!run.draft_html?.trim() || !run.draft_llms_txt?.trim()) return fail(400, "Der Entwurf ist unvollständig.");

  const now = input.now ?? new Date();
  const day = berlinDay(now);
  const html = applyReviewToHtml(run.draft_html, { day, reviewer: GROUNDING_REVIEWER.name });
  const llmsTxt = applyReviewToLlmsTxt(run.draft_llms_txt, { day, reviewer: GROUNDING_REVIEWER.name });
  const validation = validateGroundingDraft({
    html,
    llmsTxt,
    model: parseGroundingFactModel(run.fact_model),
    reviewed: true,
    reviewDay: day,
    generated: isGenerated(run),
    now,
  });
  if (!validation.ok) {
    const first = validation.issues.find((i) => i.severity === "error");
    return fail(422, `Freigabe nicht möglich: ${first?.message ?? "Die Prüfung der Dateien ist fehlgeschlagen."}`, validation);
  }
  return {
    ok: true,
    value: await updateRun(
      service,
      run.id,
      {
        status: "approved",
        draft_html: html,
        draft_llms_txt: llmsTxt,
        validation,
        standard_version: GROUNDING_STANDARD_VERSION,
        reviewed_by: input.userId,
        reviewed_at: now.toISOString(),
        reviewer_name: reviewerName.slice(0, 200),
        review_checklist: input.checklist,
        review_note: input.note?.trim().slice(0, 2_000) || null,
      },
      "draft",
    ),
  };
}

export async function rejectDraft(
  service: SupabaseClient,
  run: DtGroundingRunRow,
  input: { userId: string; reviewerName: string; note?: string | null; checklist?: ReviewChecklist | null; now?: Date },
): Promise<ActionResult<DtGroundingRunRow>> {
  if (run.status !== "draft" && run.status !== "approved") return fail(409, "Nur ein Entwurf lässt sich ablehnen.");
  return {
    ok: true,
    value: await updateRun(service, run.id, {
      status: "rejected",
      reviewed_by: input.userId,
      reviewed_at: (input.now ?? new Date()).toISOString(),
      reviewer_name: input.reviewerName.trim().slice(0, 200) || null,
      review_checklist: input.checklist ?? null,
      review_note: input.note?.trim().slice(0, 2_000) || null,
    }),
  };
}

function webPageDate(html: string | null, key: "dateModified" | "lastReviewed"): string | null {
  if (!html) return null;
  const page = parseJsonLdFromHtml(html).nodes.find((n) => hasType(n, ["WebPage"]));
  const value = page?.[key];
  return typeof value === "string" ? value.slice(0, 10) : null;
}

/**
 * The person uploaded both files by hand. The hub in dt_grounding_pages gets URL, upload
 * date, dateModified and the documented review, so the 3-month rhythm starts again; the
 * old dt_org_config columns are mirrored for older readers.
 */
export async function markRunUploaded(
  service: SupabaseClient,
  run: DtGroundingRunRow,
  input: { userId: string; url?: string | null; now?: Date },
): Promise<ActionResult<DtGroundingRunRow>> {
  if (run.status !== "approved") return fail(409, "Erst freigeben, dann als hochgeladen markieren.");
  const now = input.now ?? new Date();
  const model = parseGroundingFactModel(run.fact_model);
  const url = input.url?.trim() || run.grounding_url_checked || model?.pageUrl;
  if (!url) return fail(400, "Bitte die URL der hochgeladenen Grounding Page angeben.");

  const { data: hubRow, error: hubError } = await service
    .from("dt_grounding_pages")
    .select(DT_GROUNDING_PAGE_SELECT)
    .eq("organisation_id", run.organisation_id)
    .eq("kind", "hub")
    .maybeSingle();
  if (hubError) return fail(500, hubError.message);
  const hub = (hubRow as DtGroundingPageRow | null) ?? null;

  const reviewedDay = webPageDate(run.draft_html, "lastReviewed") ?? (run.reviewed_at ? berlinDay(new Date(run.reviewed_at)) : berlinDay(now));
  const built = buildGroundingPageUpdate(
    {
      kind: "hub",
      url,
      uploadedAt: now.toISOString(),
      dateModified: webPageDate(run.draft_html, "dateModified") ?? berlinDay(now),
      lastReviewed: reviewedDay,
      reviewedBy: GROUNDING_REVIEWER.name,
      standardVersion: GROUNDING_STANDARD_VERSION,
    },
    hub,
    // The review date is a German calendar day; between 0 and 2 a.m. it is ahead of UTC.
    new Date(`${berlinDay(now)}T12:00:00Z`),
  );
  if (!built.ok) return fail(400, built.message);
  const note = `Website-Abgleich ${berlinDay(now)}: hochgeladen (${berlinMonth(now)})`;

  if (hub) {
    const { error } = await service
      .from("dt_grounding_pages")
      .update({ ...built.update, notes: [hub.notes?.trim(), note].filter(Boolean).join("\n").slice(0, 4_000) })
      .eq("id", hub.id);
    if (error) return fail(error.code === "23505" ? 409 : 500, error.code === "23505" ? "Diese URL ist schon als Entitätsseite erfasst." : error.message);
  } else {
    const { error } = await service.from("dt_grounding_pages").insert({
      organisation_id: run.organisation_id,
      created_by_user_id: input.userId,
      position: 0,
      notes: note,
      ...built.update,
    });
    if (error) return fail(error.code === "23505" ? 409 : 500, error.code === "23505" ? "Diese URL ist schon als Entitätsseite erfasst." : error.message);
  }

  const { data: config } = await service.from("dt_org_config").select("website_url, grounding_llms_txt_url").eq("organisation_id", run.organisation_id).maybeSingle();
  const configPatch: Record<string, unknown> = { grounding_page_url: url, grounding_page_uploaded_at: now.toISOString() };
  if (!config?.grounding_llms_txt_url && config?.website_url) {
    try {
      configPatch.grounding_llms_txt_url = run.llms_txt_url_checked ?? `${new URL(config.website_url as string).origin}/llms.txt`;
    } catch {
      /* keep the stored value */
    }
  }
  await service.from("dt_org_config").update(configPatch).eq("organisation_id", run.organisation_id);

  return {
    ok: true,
    value: await updateRun(
      service,
      run.id,
      { status: "uploaded", uploaded_at: now.toISOString(), uploaded_by: input.userId, uploaded_url: url },
      "approved",
    ),
  };
}
