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
  type TextOutput,
} from "@/lib/dt/content/pipeline/prompts";
import { readRephraseProgress, rephraseBlockCount, type RephraseProgress } from "@/lib/dt/content/pipeline/rephrase";
import { runRephraseOnBlocks } from "@/lib/dt/content/pipeline/rephrase-runner";
import { stepPatchFor } from "@/lib/dt/content/pipeline/step-patch";
import { contentStepDefinition, type ContentStepDefinition } from "@/lib/dt/content/pipeline/steps";
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
import { loadContentStepPrompts } from "@/lib/dt/content/step-prompts";
import { loadTexterPrompt } from "@/lib/dt/content/texter-prompt";
import { loadContentTypePromptsForRun } from "@/lib/dt/content/type-prompts-db";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";

export type StepOutcome = {
  step: number;
  /** True when the pipeline must stop here (questions for the customer, finished, or stopped). */
  halted: boolean;
  /** The page was stopped or reset while the model was answering; nothing was saved. */
  discarded?: boolean;
  /**
   * The step saved its progress but is not done (step 8 ran out of job budget between two
   * chunks): the job continues it in the next tick, without counting a failed attempt.
   */
  partial?: boolean;
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
  // The editable texts (Texter prompt, Textvorlagen, step instructions) are read for every
  // step, so a save under Globale Prompts reaches the next step without a deploy.
  const [{ data: organisation }, settingsRow, anbieter, outlinePages, existingText, typePrompts, texterPrompt, stepPrompts] = await Promise.all([
    service.from("organisations").select("name").eq("id", page.organisation_id).maybeSingle(),
    loadContentSettings(service, page.organisation_id),
    loadContentAnbieterSources(service, page.organisation_id),
    loadContentPageOutline(service, page.organisation_id),
    loadExistingText(service, page),
    loadContentTypePromptsForRun(service),
    loadTexterPrompt(service),
    loadContentStepPrompts(service),
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
      texterPrompt,
      stepPrompts,
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
 * One tool call on Claude, plus the step's own second attempt when its `retryHint` asks for
 * one and enough of the budget is left. Both calls are billed; the better-scored output is
 * kept. Step 8 does not come through here (see `runRephraseStep`).
 */
async function callStep(
  spec: ContentStepSpec,
  context: ContentPipelineContext,
  models: string[],
  timeoutMs: number | undefined,
): Promise<{ output: unknown; calls: ModelCall[] }> {
  const budget = timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const started = Date.now();
  const invoke = (user: string, timeout: number | undefined): Promise<ModelCall> =>
    callContentTool({ models, system: spec.system, user, tool: spec.tool, maxTokens: spec.maxTokens, timeoutMs: timeout });
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
  if (def.provider === "xai") {
    return runRephraseStep({ service, page, def, steps, context, avatarId, timeoutMs });
  }
  const models = await loadContentModelConfig(service);
  const spec = contentStepSpec(step, context);
  const { output, calls } = await callStep(spec, context, models[def.tier], timeoutMs);
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

  const { pagePatch, stepStatus, halted } = stepPatchFor(def, output, page);
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

/** Stopped or reset while the model was answering? Then nothing more is saved for this page. */
async function pageStillRunning(service: SupabaseClient, pageId: string): Promise<boolean> {
  const { data, error } = await service.from("dt_content_pages").select("state").eq("id", pageId).maybeSingle();
  return Boolean(error) || data?.state === "laeuft";
}

/**
 * Step 8 on Grok, in chunks (`rephrase-runner.ts`, shared with the Watermark tool under
 * Verwaltung). Each group of sections is one short call; the rewritten HTML lands in the
 * step row's output after every call, so a worker that dies or a job budget that runs out
 * loses at most one chunk. With little budget left the step hands back `partial`, the job
 * reschedules without a failed attempt, and the next tick resumes with the chunks still
 * open. Every call is billed on the page like the Claude steps.
 */
async function runRephraseStep(input: {
  service: SupabaseClient;
  page: ContentPageRow;
  def: ContentStepDefinition;
  steps: ContentStepRow[];
  context: ContentPipelineContext;
  avatarId: string | null;
  timeoutMs: number | undefined;
}): Promise<StepOutcome> {
  const { service, page, def, context } = input;
  const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS);
  const progress: RephraseProgress = readRephraseProgress(
    input.steps.find((s) => s.step === def.step)?.output,
    rephraseBlockCount(context.blocks),
  );

  const saveProgress = (model: string, patch: Partial<ContentStepRow>) =>
    upsertStep(service, page, def.step, {
      output: progress as unknown as Record<string, unknown>,
      model,
      input_tokens: progress.input_tokens,
      output_tokens: progress.output_tokens,
      cost_eur: progress.cost_eur,
      error: null,
      ...patch,
    });

  const run = await runRephraseOnBlocks(context, context.blocks, {
    progress,
    deadline,
    onUsage: (usage) =>
      recordLlmUsageEvent(service, {
        organisationId: page.organisation_id,
        userId: page.started_by,
        agentId: input.avatarId,
        mode: `content.${def.step}`,
        via: "direct",
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      }),
    save: (_progress, info) =>
      saveProgress(info.model, info.reason === "paused" ? { status: "pending", finished_at: null } : { status: "running" }),
    stillWanted: () => pageStillRunning(service, page.id),
  });
  if (run.state === "partial") {
    return { step: def.step, halted: false, partial: true, model: run.model, costEur: 0 };
  }
  if (run.state === "discarded") {
    return { step: def.step, halted: true, discarded: true, model: run.model, costEur: progress.cost_eur };
  }

  const output: TextOutput = {
    blocks: run.blocks,
    title: context.title,
    meta_description: context.metaDescription,
  };
  const { pagePatch, stepStatus, halted } = stepPatchFor(def, output, page);
  pagePatch.cost_eur = roundEur(num(page.cost_eur) + progress.cost_eur);
  await saveProgress(run.model, { status: stepStatus, finished_at: new Date().toISOString() });
  const { error } = await service.from("dt_content_pages").update(pagePatch).eq("id", page.id);
  if (error) throw new Error(`Seite konnte nicht gespeichert werden: ${error.message}`);
  return { step: def.step, halted, model: run.model, costEur: progress.cost_eur };
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
