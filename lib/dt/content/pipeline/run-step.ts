/**
 * Executes one pipeline step for a page: loads the context, calls the model, stores the
 * result on `dt_content_steps` and `dt_content_pages`. Called by the `content.page` job.
 * A step the editor switched off for the page goes through `skipContentStep` instead.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { defaultAvatarOptionId } from "@/lib/dt/agents/mix";
import {
  loadContentAnbieterSources,
  loadContentAvatarOptions,
  loadContentAvatarRow,
} from "@/lib/dt/content/load-sources";
import { readAktualitaetProgress, type AktualitaetProgress } from "@/lib/dt/content/freshness";
import { avatarFromAgent } from "@/lib/dt/content/mapping";
import { loadContentModelConfig } from "@/lib/dt/content/model-config-db";
import { effectiveContentPageType } from "@/lib/dt/content/page-types";
import {
  aktualitaetNeedsNoResult,
  aktualitaetResearchPrompt,
  aktualitaetTextKey,
  aktualitaetWriteSpec,
  inspectResearchBlocks,
  researchFromCall,
  researchProblem,
  unchangedAktualitaetOutput,
  type AktualitaetOutput,
} from "@/lib/dt/content/pipeline/aktualitaet";
import { ContentLlmError, callContentResearch, callContentTool } from "@/lib/dt/content/pipeline/llm";
import {
  contentStepSpec,
  type ContentPipelineContext,
  type ContentStepSpec,
  type FaktencheckOutput,
  type TextOutput,
} from "@/lib/dt/content/pipeline/prompts";
import { readRephraseProgress, rephraseBlockCount, type RephraseProgress } from "@/lib/dt/content/pipeline/rephrase";
import { runRephraseOnBlocks } from "@/lib/dt/content/pipeline/rephrase-runner";
import {
  liveTextFailureMessage,
  skippedStepPatch,
  stepPatchFor,
  type LiveTextImport,
} from "@/lib/dt/content/pipeline/step-patch";
import {
  CONTENT_STEP_AKTUALITAET,
  CONTENT_STEP_FAKTENCHECK,
  contentStepDefinition,
  contentStepSkippable,
  type ContentStepDefinition,
} from "@/lib/dt/content/pipeline/steps";
import { estimateCostEur, estimateWebSearchCostEur, roundEur } from "@/lib/dt/content/pricing";
import { parseBlocksFromHtml } from "@/lib/dt/content/render";
import {
  contentDbErrorMessage,
  contentStructureOutline,
  loadContentPageOutline,
  loadContentSettings,
  num,
  resetContentStepsFrom,
  settingsFromRow,
  type ContentPageRow,
  type ContentStepRow,
} from "@/lib/dt/content/store";
import { loadContentStepPrompts } from "@/lib/dt/content/step-prompts";
import { loadTexterPrompt } from "@/lib/dt/content/texter-prompt";
import { loadContentTypePromptsForRun } from "@/lib/dt/content/type-prompts-db";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import { loadCrawledPageInput } from "@/lib/dt/text-tools/crawl-source";

export type StepOutcome = {
  step: number;
  /** True when the pipeline must stop here (questions for the customer, finished, or stopped). */
  halted: boolean;
  /** The page was stopped or reset while the model was answering; nothing was saved. */
  discarded?: boolean;
  /**
   * The step saved its progress but is not done (Watermark Entfernung ran out of job budget
   * between two chunks, the Aktualitätsprüfung between its research and its result): the job
   * continues it in the next tick, without counting a failed attempt.
   */
  partial?: boolean;
  /** The editor switched the step off: marked „skipped“, no model call, 0 €. */
  skipped?: boolean;
  model: string;
  costEur: number;
};

/** How much of the live page's text the prompts see (pages taken over from the crawl). */
const EXISTING_TEXT_MAX_CHARS = 6_000;
/** A second attempt inside one step (Vermenschlichung) needs this much of the budget left. */
const MIN_RETRY_MS = 60_000;
const DEFAULT_STEP_TIMEOUT_MS = 240_000;
/** The Aktualitätsprüfung's web research may use this much of a tick; the result call needs the rest. */
const AKTUALITAET_RESEARCH_MAX_MS = 150_000;
/**
 * The result call writes the whole text (like GEO). With less budget than this left after the
 * research, it waits for the next tick; the research is saved and not paid twice.
 */
const AKTUALITAET_WRITE_MIN_MS = 100_000;

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
    avatarId = defaultAvatarOptionId(await loadContentAvatarOptions(service, page.organisation_id));
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
      freshness: page.freshness,
      openFindings: page.findings,
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
 * kept. Watermark Entfernung does not come through here (see `runRephraseStep`); the
 * Aktualitätsprüfung uses it for its result call only.
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
  if (def.step === CONTENT_STEP_AKTUALITAET) {
    return runAktualitaetStep({ service, page, def, steps, context, avatarId, timeoutMs });
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

/**
 * The Aktualitätsprüfung in two calls (`aktualitaet.ts`): the web research with web search and
 * web fetch, then the tool-forced result that may only cite what the research returned. The
 * research and its cost are saved in the step row as soon as they are in, so a job budget that
 * runs out before the result (`partial`) or a failed result call does not search again. Every
 * call is recorded with its tokens and searches; the searches are billed on the step and the
 * page like the tokens. A send-back to GEO resets GEO and this step and the job goes on.
 */
async function runAktualitaetStep(input: {
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
  const progress: AktualitaetProgress = readAktualitaetProgress(
    input.steps.find((s) => s.step === def.step)?.output,
    aktualitaetTextKey(context),
  );
  const models = (await loadContentModelConfig(service))[def.tier];
  let model = progress.models[progress.models.length - 1] ?? models[0] ?? "";

  const bill = async (call: { model: string; usage: { inputTokens: number; outputTokens: number }; web?: { webSearchRequests: number; webFetchRequests: number } }) => {
    const searches = call.web?.webSearchRequests ?? 0;
    const fetches = call.web?.webFetchRequests ?? 0;
    progress.calls += 1;
    progress.input_tokens += call.usage.inputTokens;
    progress.output_tokens += call.usage.outputTokens;
    progress.web_search_requests += searches;
    progress.web_fetch_requests += fetches;
    progress.cost_eur = roundEur(progress.cost_eur + estimateCostEur(call.model, call.usage) + estimateWebSearchCostEur(searches));
    progress.models = [...progress.models, call.model].slice(-10);
    model = call.model;
    await recordLlmUsageEvent(service, {
      organisationId: page.organisation_id,
      userId: page.started_by,
      agentId: input.avatarId,
      mode: `content.${def.step}`,
      via: "direct",
      model: call.model,
      inputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
      webSearchRequests: searches,
      webFetchRequests: fetches,
    });
  };
  const saveProgress = (patch: Partial<ContentStepRow> = {}) =>
    upsertStep(service, page, def.step, {
      output: progress as unknown as Record<string, unknown>,
      model,
      input_tokens: progress.input_tokens,
      output_tokens: progress.output_tokens,
      cost_eur: progress.cost_eur,
      error: null,
      ...patch,
    });

  if (!progress.research) {
    const prompt = aktualitaetResearchPrompt(context);
    const billedBefore = progress.calls;
    let result: Awaited<ReturnType<typeof callContentResearch>>;
    try {
      result = await callContentResearch({
        models,
        system: prompt.system,
        user: prompt.user,
        maxTokens: prompt.maxTokens,
        timeoutMs: Math.min(AKTUALITAET_RESEARCH_MAX_MS, deadline - Date.now()),
        onCall: bill,
      });
    } catch (error) {
      // Rounds that were answered are paid: their cost stays on the step for the page total.
      if (progress.calls > billedBefore && (await pageStillRunning(service, page.id))) {
        await saveProgress().catch((err) => console.error("[content] research cost not stored", err));
      }
      throw error;
    }
    if (!(await pageStillRunning(service, page.id))) {
      return { step: def.step, halted: true, discarded: true, model, costEur: progress.cost_eur };
    }
    const inspection = inspectResearchBlocks(result.blocks);
    const research = researchFromCall(result.text, inspection, {
      searches: result.calls.reduce((sum, call) => sum + call.web.webSearchRequests, 0),
      fetches: result.calls.reduce((sum, call) => sum + call.web.webFetchRequests, 0),
    });
    const problem = researchProblem(research, inspection);
    if (problem) {
      // Never „alles aktuell“ without a source: the step fails visibly, the cost stays recorded.
      await saveProgress();
      throw new ContentLlmError(problem.message, problem.retryable);
    }
    progress.research = research;
    if (deadline - Date.now() < AKTUALITAET_WRITE_MIN_MS) {
      await saveProgress({ status: "pending", finished_at: null });
      return { step: def.step, halted: false, partial: true, model, costEur: 0 };
    }
    await saveProgress({ status: "running" });
  }

  const research = progress.research;
  if (!research) throw new ContentLlmError("Die Recherche der Aktualitätsprüfung fehlt. Der Schritt wird erneut versucht.", true);
  let output: AktualitaetOutput;
  if (aktualitaetNeedsNoResult(research)) {
    output = unchangedAktualitaetOutput(context, research);
  } else {
    const spec = aktualitaetWriteSpec(context, research);
    const { output: written, calls } = await callStep(spec, context, models, Math.max(30_000, deadline - Date.now()));
    for (const call of calls) await bill(call);
    output = written as AktualitaetOutput;
  }

  if (!(await pageStillRunning(service, page.id))) {
    return { step: def.step, halted: true, discarded: true, model, costEur: progress.cost_eur };
  }

  // With GEO switched off the Faktencheck's findings are still open; the patch keeps them.
  const faktencheck = context.outputs[CONTENT_STEP_FAKTENCHECK] as Partial<FaktencheckOutput> | undefined;
  const { pagePatch, stepStatus, halted, resetFrom } = stepPatchFor(def, output, {
    ...page,
    faktencheck_findings: Array.isArray(faktencheck?.findings) ? faktencheck.findings : [],
  });
  pagePatch.cost_eur = roundEur(num(page.cost_eur) + progress.cost_eur);
  await upsertStep(service, page, def.step, {
    status: stepStatus,
    output: output as unknown as Record<string, unknown>,
    model,
    input_tokens: progress.input_tokens,
    output_tokens: progress.output_tokens,
    cost_eur: progress.cost_eur,
    error: null,
    finished_at: new Date().toISOString(),
  });
  const { error } = await service.from("dt_content_pages").update(pagePatch).eq("id", page.id);
  if (error) throw new Error(contentDbErrorMessage(error, "Seite konnte nicht gespeichert werden"));
  if (resetFrom != null) {
    // Send-back: GEO reworks the outdated Abschnitte, then this step checks once more.
    await resetContentStepsFrom(service, page.id, resetFrom);
  }
  return { step: def.step, halted, model, costEur: progress.cost_eur };
}

/** Stopped or reset while the model was answering? Then nothing more is saved for this page. */
async function pageStillRunning(service: SupabaseClient, pageId: string): Promise<boolean> {
  const { data, error } = await service.from("dt_content_pages").select("state").eq("id", pageId).maybeSingle();
  return Boolean(error) || data?.state === "laeuft";
}

/**
 * Watermark Entfernung on Grok, in chunks (`rephrase-runner.ts`, shared with the Watermark
 * tool under Verwaltung). Each group of sections is one short call; the rewritten HTML lands in the
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

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * SEO switched off on a crawl page: the live page as the text tools read it (live HTML with
 * headings, else the stored crawl text). Any failure is final for this attempt: the page
 * pauses with the reason instead of going on without a text.
 */
async function loadLiveText(
  service: SupabaseClient,
  page: ContentPageRow,
  fetchImpl: FetchLike | undefined,
): Promise<LiveTextImport> {
  const allowed = contentStepSkippable(page, "seo");
  if (!allowed.ok || !page.source_url) {
    throw new ContentLlmError(liveTextFailureMessage("Die Seite stammt nicht (mehr) aus dem Crawl der Website"), false);
  }
  const loaded = await loadCrawledPageInput(service, page.organisation_id, page.source_url, fetchImpl ? { fetchImpl } : {});
  if (!loaded.ok) throw new ContentLlmError(liveTextFailureMessage(loaded.message), false);
  return { source: loaded.value.source, url: loaded.value.url, ingested: loaded.value.ingested };
}

/**
 * The run reached a step the editor switched off (`skipsContentStep`): no model, no usage
 * event, 0 €. The row becomes „skipped“, the page moves on to it with its text unchanged,
 * except where `skippedStepPatch` says (SEO: the live text, Hormozi: no empty hero). Saved
 * progress of an earlier attempt (Watermark chunks, the Aktualitätsprüfung's research) is
 * dropped. Like every step, nothing is written when the page was stopped or reset meanwhile.
 */
export async function skipContentStep(
  service: SupabaseClient,
  page: ContentPageRow,
  steps: readonly ContentStepRow[],
  step: number,
  options: { fetchImpl?: FetchLike; now?: Date } = {},
): Promise<StepOutcome> {
  const def = contentStepDefinition(step);
  if (!def) throw new ContentLlmError(`Unbekannter Schritt ${step}.`, false);

  const live = def.key === "seo" ? await loadLiveText(service, page, options.fetchImpl) : null;
  if (!(await pageStillRunning(service, page.id))) {
    return { step, halted: true, discarded: true, skipped: true, model: "", costEur: 0 };
  }

  const row = steps.find((s) => s.step === step);
  const { stepRow, pagePatch, halted } = skippedStepPatch(def, page, { live, paidBefore: num(row?.cost_eur), now: options.now });
  await upsertStep(service, page, step, stepRow);
  const { error } = await service.from("dt_content_pages").update(pagePatch).eq("id", page.id).eq("state", "laeuft");
  if (error) throw new Error(contentDbErrorMessage(error, "Seite konnte nicht gespeichert werden"));
  return { step, halted, skipped: true, model: "", costEur: 0 };
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
    // The step number itself may be what the database rejects (fewer steps allowed, migration
    // 20261027 not run): pause the page anyway, with the reason, on its last stored step.
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
