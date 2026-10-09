/**
 * Executes one pipeline step for a page: loads the context, calls the model, stores the
 * result on `dt_content_steps` and `dt_content_pages`. Called by the `content.page` job.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadContentAnbieterSources,
  loadContentAvatarOptions,
  loadContentAvatarRow,
} from "@/lib/dt/content/load-sources";
import { avatarFromAgent } from "@/lib/dt/content/mapping";
import { loadContentModelConfig } from "@/lib/dt/content/model-config-db";
import { effectiveContentPageType } from "@/lib/dt/content/page-types";
import { ContentLlmError, callContentTool } from "@/lib/dt/content/pipeline/llm";
import {
  contentStepSpec,
  type ContentPipelineContext,
  type ContentStepSpec,
} from "@/lib/dt/content/pipeline/prompts";
import { stepPatchFor } from "@/lib/dt/content/pipeline/step-patch";
import { contentStepDefinition, type ContentStepDefinition } from "@/lib/dt/content/pipeline/steps";
import { callXaiTool } from "@/lib/dt/content/pipeline/xai";
import { estimateCostEur, roundEur } from "@/lib/dt/content/pricing";
import { parseBlocksFromHtml } from "@/lib/dt/content/render";
import {
  contentDbErrorMessage,
  contentStructureOutline,
  loadContentPageOutline,
  loadContentSettings,
  num,
  settingsFromRow,
  type ContentPageRow,
  type ContentStepRow,
} from "@/lib/dt/content/store";
import { loadContentTypePromptsForRun } from "@/lib/dt/content/type-prompts-db";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";

export type StepOutcome = {
  step: number;
  /** True when the pipeline must stop here (questions for the customer, finished, or stopped). */
  halted: boolean;
  /** The page was stopped or reset while the model was answering; nothing was saved. */
  discarded?: boolean;
  model: string;
  costEur: number;
};

/** How much of the live page's text the prompts see (pages taken over from the crawl). */
const EXISTING_TEXT_MAX_CHARS = 6_000;
/** A second attempt inside one step (Vermenschlichung) needs this much of the budget left. */
const MIN_RETRY_MS = 60_000;
const DEFAULT_STEP_TIMEOUT_MS = 240_000;

/** The current text of a page taken over from the crawl, or null (structure pages, no crawl row). */
async function loadExistingText(service: SupabaseClient, page: ContentPageRow): Promise<string | null> {
  if (!page.source_url) return null;
  const { data, error } = await service
    .from("dt_site_pages")
    .select("text_content")
    .eq("organisation_id", page.organisation_id)
    .eq("url", page.source_url)
    .maybeSingle();
  if (error) {
    console.warn("[content] live page text not readable:", error.message);
    return null;
  }
  const text = (data?.text_content as string | null | undefined)?.trim() ?? "";
  return text ? text.slice(0, EXISTING_TEXT_MAX_CHARS) : null;
}

async function loadContext(
  service: SupabaseClient,
  page: ContentPageRow,
  steps: ContentStepRow[],
): Promise<{ context: ContentPipelineContext; avatarId: string | null }> {
  const [{ data: organisation }, settingsRow, anbieter, outlinePages, existingText, typePrompts] = await Promise.all([
    service.from("organisations").select("name").eq("id", page.organisation_id).maybeSingle(),
    loadContentSettings(service, page.organisation_id),
    loadContentAnbieterSources(service, page.organisation_id),
    loadContentPageOutline(service, page.organisation_id),
    loadExistingText(service, page),
    loadContentTypePromptsForRun(service),
  ]);
  if (!settingsRow) {
    throw new ContentLlmError("Die Einstellungen für Texte sind noch nicht bestätigt.", false);
  }
  const sections = anbieter.sections;
  if (sections.length === 0) {
    throw new ContentLlmError(
      "Keine Anbieterfakten vorhanden (weder Anbieter-Fragebogen noch ausgewertete Gespräche).",
      false,
    );
  }

  let avatarId = settingsRow.avatar_agent_id;
  if (!avatarId) {
    const [newest] = await loadContentAvatarOptions(service, page.organisation_id);
    avatarId = newest?.id ?? null;
  }
  const avatarRow = avatarId ? await loadContentAvatarRow(service, page.organisation_id, avatarId) : null;
  const avatar = avatarRow ? avatarFromAgent(avatarRow) : null;

  const outputs: ContentPipelineContext["outputs"] = {};
  for (const row of steps) {
    if (row.status === "done" || row.status === "waiting") outputs[row.step] = row.output;
  }

  return {
    avatarId: avatarRow?.id ?? null,
    context: {
      organisationName: (organisation?.name as string | undefined)?.trim() || "",
      page: {
        name: page.name,
        path: page.path,
        level: page.level,
        url: page.source_url,
        source: page.source,
        page_role: page.page_role,
        page_type: effectiveContentPageType(page),
        pillar_name: page.pillar_name,
        estimated_traffic: page.estimated_traffic,
        keywords: page.keywords,
        h1_options: page.h1_options,
        user_questions: page.user_questions,
        ki_prompt: page.ki_prompt,
        internal_link_targets: page.internal_link_targets,
      },
      structureOutline: contentStructureOutline(outlinePages, page),
      existingText,
      sections,
      settings: settingsFromRow(settingsRow),
      avatar: avatar ? { name: avatar.name, role: avatar.role, beschreibung: avatar.beschreibung } : null,
      typePrompts,
      notes: page.notes,
      outputs,
      blocks: parseBlocksFromHtml(page.html),
      title: page.title,
      metaDescription: page.meta_description,
    },
  };
}

async function upsertStep(
  service: SupabaseClient,
  page: ContentPageRow,
  step: number,
  patch: Partial<ContentStepRow>,
): Promise<void> {
  const def = contentStepDefinition(step);
  const { error } = await service.from("dt_content_steps").upsert(
    { page_id: page.id, organisation_id: page.organisation_id, step, name: def?.name ?? `Schritt ${step}`, ...patch },
    { onConflict: "page_id,step" },
  );
  if (error) throw new Error(contentDbErrorMessage(error, "Schritt konnte nicht gespeichert werden"));
}

type ModelCall = { json: unknown; usage: { inputTokens: number; outputTokens: number }; model: string };

/**
 * One tool call on the step's provider (Claude for every step but 8, Grok for step 8), plus
 * the step's own second attempt when its `retryHint` asks for one and enough of the budget
 * is left. Both calls are billed; the better-scored output is kept.
 */
async function callStep(
  spec: ContentStepSpec,
  context: ContentPipelineContext,
  def: ContentStepDefinition,
  models: string[],
  timeoutMs: number | undefined,
): Promise<{ output: unknown; calls: ModelCall[] }> {
  const budget = timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const started = Date.now();
  const invoke = (user: string, timeout: number | undefined): Promise<ModelCall> =>
    def.provider === "xai"
      ? callXaiTool({ system: spec.system, user, tool: spec.tool, maxTokens: spec.maxTokens, timeoutMs: timeout })
      : callContentTool({ models, system: spec.system, user, tool: spec.tool, maxTokens: spec.maxTokens, timeoutMs: timeout });
  const first = await invoke(spec.user, timeoutMs);
  let output = spec.normalize(first.json, context);
  const calls: ModelCall[] = [first];

  const hint = spec.retryHint?.(output) ?? null;
  const remaining = budget - (Date.now() - started);
  if (hint && remaining >= MIN_RETRY_MS) {
    try {
      const second = await invoke(`${spec.user}\n\n${hint}`, remaining);
      calls.push(second);
      const retried = spec.normalize(second.json, context);
      const better = spec.score ? spec.score(retried) >= spec.score(output) : true;
      if (better) output = retried;
    } catch (error) {
      // The first attempt stands; a failed retry must not cost the step.
      console.warn("[content] retry inside step failed:", error instanceof Error ? error.message : error);
    }
  }
  return { output, calls };
}

export async function runContentStep(
  service: SupabaseClient,
  page: ContentPageRow,
  steps: ContentStepRow[],
  step: number,
  timeoutMs?: number,
): Promise<StepOutcome> {
  const def = contentStepDefinition(step);
  if (!def) throw new ContentLlmError(`Unbekannter Schritt ${step}.`, false);

  await upsertStep(service, page, step, {
    status: "running",
    error: null,
    started_at: new Date().toISOString(),
    finished_at: null,
  });
  await service.from("dt_content_pages").update({ step, error: null }).eq("id", page.id);

  const { context, avatarId } = await loadContext(service, page, steps);
  const models = await loadContentModelConfig(service);
  const spec = contentStepSpec(step, context);
  const { output, calls } = await callStep(spec, context, def, models[def.tier], timeoutMs);
  const model = calls[calls.length - 1]!.model;
  const usage = calls.reduce(
    (sum, call) => ({ inputTokens: sum.inputTokens + call.usage.inputTokens, outputTokens: sum.outputTokens + call.usage.outputTokens }),
    { inputTokens: 0, outputTokens: 0 },
  );
  const costEur = calls.reduce((sum, call) => sum + estimateCostEur(call.model, call.usage), 0);

  for (const call of calls) {
    await recordLlmUsageEvent(service, {
      organisationId: page.organisation_id,
      userId: page.started_by,
      agentId: avatarId,
      mode: `content.${step}`,
      via: "direct",
      model: call.model,
      inputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
    });
  }

  // „Stoppen“ or „Zurücksetzen“ while the model was answering: the cost is recorded above,
  // the result must not land on a page that is no longer running (or no longer exists).
  const { data: live, error: liveError } = await service
    .from("dt_content_pages")
    .select("state")
    .eq("id", page.id)
    .maybeSingle();
  if (!liveError && live?.state !== "laeuft") {
    return { step, halted: true, discarded: true, model, costEur };
  }

  const { pagePatch, stepStatus, halted } = stepPatchFor(def, output);
  pagePatch.cost_eur = roundEur(num(page.cost_eur) + costEur);

  await upsertStep(service, page, step, {
    status: stepStatus,
    output: output as Record<string, unknown>,
    model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cost_eur: roundEur(costEur),
    error: null,
    finished_at: new Date().toISOString(),
  });
  const { error } = await service.from("dt_content_pages").update(pagePatch).eq("id", page.id);
  if (error) throw new Error(`Seite konnte nicht gespeichert werden: ${error.message}`);

  return { step, halted, model, costEur };
}

/** Pause the page with the error visible in the table and drawer. */
export async function markContentStepError(
  service: SupabaseClient,
  page: ContentPageRow,
  step: number,
  message: string,
): Promise<void> {
  const text = message.slice(0, 500);
  await upsertStep(service, page, step, {
    status: "error",
    error: text,
    finished_at: new Date().toISOString(),
  }).catch((err) => console.error("[content] step error not stored", err));
  const { error } = await service
    .from("dt_content_pages")
    .update({ state: "in_arbeit", step, error: text, job_id: null })
    .eq("id", page.id);
  if (error) {
    // The step number itself may be what the database rejects (steps 1 … 8 only, migration
    // 20261011 not run): pause the page anyway, with the reason, on its last stored step.
    await service
      .from("dt_content_pages")
      .update({ state: "in_arbeit", error: contentDbErrorMessage(error, text).slice(0, 500), job_id: null })
      .eq("id", page.id);
  }
}

/**
 * The runner will try the step again later (rate limit, overload, interrupted worker). The
 * page stays `laeuft`, but the step row goes back to `pending` and the reason is on the page,
 * so the table says „wird erneut versucht“ instead of „läuft“ for minutes.
 */
export async function markContentStepRetry(
  service: SupabaseClient,
  page: ContentPageRow,
  step: number,
  message: string,
): Promise<void> {
  const text = message.slice(0, 500);
  await upsertStep(service, page, step, {
    status: "pending",
    error: text,
    finished_at: new Date().toISOString(),
  }).catch((err) => console.error("[content] step retry not stored", err));
  await service
    .from("dt_content_pages")
    .update({ step, error: text })
    .eq("id", page.id)
    .eq("state", "laeuft");
}
