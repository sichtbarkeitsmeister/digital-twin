/**
 * Executes one pipeline step for a page: loads the context, calls the model, stores the
 * result on `dt_content_steps` and `dt_content_pages`. Called by the `content.page` job.
 * A step the editor switched off for the page goes through `skipContentStep` instead.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { defaultAvatarOptionId } from "@/lib/dt/agents/mix";
import { contactPromptData } from "@/lib/dt/contact-data";
import { loadOrgContactData } from "@/lib/dt/contact-data-store";
import { addOrgQuestions, customerAnswersFromPool, loadOrgQuestions } from "@/lib/dt/content/org-questions";
import {
  ANSWERS_MAX_TOKENS,
  ANSWERS_TOOL,
  ANSWERS_USAGE_MODE,
  answerTargets,
  answersPassPrompt,
  applyDrops,
  normalizeAnswersOutput,
} from "@/lib/dt/content/pipeline/answers";
import type { ContentFinding } from "@/lib/dt/content/types";
import { rephraseProtectedTerms, rephraseRejectedFindings } from "@/lib/dt/content/pipeline/rephrase-guard";
import { planQuestionStop, questionStopOutcome, questionStopKeep, questionStopPassItems, readQuestionStop } from "@/lib/dt/content/pipeline/question-stop";
import { buildContentKnowledge, customerAnswerNote } from "@/lib/dt/content/pipeline/questions";
import { parseClientWishes } from "@/lib/dt/content/client-wishes";
import {
  loadContentAnbieterSources,
  loadContentAvatarOptions,
  loadContentAvatarRow,
  loadContentZielgruppenAvatars,
} from "@/lib/dt/content/load-sources";
import { readAktualitaetProgress, type AktualitaetProgress } from "@/lib/dt/content/freshness";
import { avatarFromAgent } from "@/lib/dt/content/mapping";
import {
  EMPTY_CONTENT_ZIELGRUPPEN,
  audienceBudget,
  audienceBudgetMessage,
  contentPrimaryMax,
  hasContentZielgruppen,
  normalizeZielgruppenLists,
} from "@/lib/dt/content/zielgruppen";
import { suggestContentZielgruppen } from "@/lib/dt/content/pipeline/zielgruppen-suggest";
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
import { extractBlockedStatements } from "@/lib/dt/content/pipeline/blocked";
import { keepPendingPlaceholders } from "@/lib/dt/content/pipeline/kunde-prueft";
import { PAGE_FACTS_USAGE_MODE, emptyPageFacts, evaluationSkipReason, pageFactsFromCall, pageFactsPrompt } from "@/lib/dt/content/pipeline/page-facts";
import { readPageFacts, withoutPageFacts, type ContentPageFacts } from "@/lib/dt/content/pipeline/page-facts-model";
import {
  contentStepSpec,
  type ContentPipelineContext,
  type ContentStepSpec,
  type FaktencheckOutput,
  type TextOutput,
  MAX_STANDALONE_MATERIAL_CHARS,
} from "@/lib/dt/content/pipeline/prompts";
import { readRephraseProgress, rephraseBlockCount, type RephraseProgress } from "@/lib/dt/content/pipeline/rephrase";
import { runRephraseOnBlocks } from "@/lib/dt/content/pipeline/rephrase-runner";
import {
  liveTextFailureMessage,
  uploadTextFailureMessage,
  skippedStepPatch,
  stepPatchFor,
  type LiveTextImport,
  type StepPatch,
} from "@/lib/dt/content/pipeline/step-patch";
import {
  CONTENT_STEP_AKTUALITAET,
  CONTENT_STEP_ANALYSE,
  CONTENT_STEP_FAKTENCHECK,
  contentStepDefinition,
  contentStepSkippable,
  type ContentStepDefinition,
} from "@/lib/dt/content/pipeline/steps";
import { estimateCostEur, estimateWebSearchCostEur, roundEur } from "@/lib/dt/content/pricing";
import { ContentTextLimitError, htmlToMarkdown, parseBlocksFromHtml, renderBlocksHtml, type ContentTextBlock } from "@/lib/dt/content/render";
import {
  contentDbErrorMessage,
  contentStructureOutline,
  isMissingStopReasonColumnError,
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
import { loadPageTextUpload } from "@/lib/dt/content/text-uploads";
import { uploadBlocksToMarkdown } from "@/lib/dt/content/upload-match";
import { loadCrawledPageInput } from "@/lib/dt/text-tools/crawl-source";
import type { WorkshopSectionStatus, WorkshopSource } from "@/lib/dt/transcripts/workshop-model";
import { loadWorkshopState } from "@/lib/dt/transcripts/workshop-store";

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
const EXISTING_TEXT_MAX_CHARS = 20_000;
/**
 * How much of an uploaded Word text the prompts see. 6.000 characters (about 900 words) cut a
 * normal service page in half; unlike the crawl text, which is page chrome plus body and only a
 * hint, the Word file IS the page the customer wrote and the step improves. 30.000 covers a
 * page of about 4.500 words whole and is the budget the standalone SEO tool already gives an
 * uploaded text (`MAX_STANDALONE_MATERIAL_CHARS`); the ingest refuses files over 60.000.
 */
export const UPLOAD_EXISTING_TEXT_MAX_CHARS = MAX_STANDALONE_MATERIAL_CHARS;
/** „Antworten einarbeiten“ with a model call starts only with this much of the job's budget left. */
const ANSWERS_MIN_MS = 60_000;
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

/**
 * The text the page has today, or null (structure pages, no crawl row): for a page taken over
 * from the crawl the stored text of the live page; for a page with an uploaded Word file that
 * file's text with its headings as Markdown lines. An upload page never reads the crawl, also
 * when the row carries a live URL.
 */
export async function loadExistingText(service: SupabaseClient, page: ContentPageRow): Promise<string | null> {
  if (page.source === "upload") {
    const upload = await loadPageTextUpload(service, page);
    const markdown = upload ? uploadBlocksToMarkdown(upload.blocks).trim() : "";
    return markdown ? markdown.slice(0, UPLOAD_EXISTING_TEXT_MAX_CHARS) : null;
  }
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

export async function loadContext(
  service: SupabaseClient,
  page: ContentPageRow,
  steps: ContentStepRow[],
): Promise<{ context: ContentPipelineContext; avatarId: string | null }> {
  // The editable texts (Texter prompt, Textvorlagen, step instructions) are read for every
  // step, so a save under Globale Prompts reaches the next step without a deploy. So are the
  // client data: the Kontaktdaten and the Kundenwünsche (settings row and page row).
  const [{ data: organisation }, settingsRow, anbieter, outlinePages, existingText, typePrompts, texterPrompt, stepPrompts, contactData, pool] = await Promise.all([
    service.from("organisations").select("name").eq("id", page.organisation_id).maybeSingle(),
    loadContentSettings(service, page.organisation_id),
    loadContentAnbieterSources(service, page.organisation_id),
    loadContentPageOutline(service, page.organisation_id),
    loadExistingText(service, page),
    loadContentTypePromptsForRun(service),
    loadTexterPrompt(service),
    loadContentStepPrompts(service),
    loadOrgContactData(service, page.organisation_id),
    loadOrgQuestions(service, page.organisation_id),
  ]);
  const contact = contactPromptData(contactData.data, { ansprechpartnerRole: contactData.columns.firstContact?.role ?? null });
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
  let avatarRow = avatarId ? await loadContentAvatarRow(service, page.organisation_id, avatarId) : null;
  const avatar = avatarRow ? avatarFromAgent(avatarRow) : null;

  // Zielgruppen of this page: they replace the Standard-Zielgruppe for every step. Avatars that were
  // deleted or switched off meanwhile drop out; without a primary one left, the standard applies.
  // The page type's limit applies here too: after a change of type, primary ones over it count as secondary.
  const stored = page.zielgruppen ?? EMPTY_CONTENT_ZIELGRUPPEN;
  const zielgruppen = { ...stored, ...normalizeZielgruppenLists(stored.primary, stored.secondary, undefined, contentPrimaryMax(page.page_type)) };
  let audience: ContentPipelineContext["audience"] = null;
  if (hasContentZielgruppen(zielgruppen)) {
    const rows = await loadContentZielgruppenAvatars(service, page.organisation_id);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const member = (id: string) => {
      const row = byId.get(id);
      if (!row) return null;
      const a = avatarFromAgent(row);
      return { name: a.name, role: a.role, beschreibung: a.beschreibung };
    };
    const primary = zielgruppen.primary.map(member).filter((m): m is NonNullable<typeof m> => m !== null);
    if (primary.length > 0) {
      audience = { primary, secondary: zielgruppen.secondary.map(member).filter((m): m is NonNullable<typeof m> => m !== null) };
      // Usage events name the first primary Zielgruppe.
      avatarRow = byId.get(zielgruppen.primary.find((id) => byId.has(id))!) ?? avatarRow;
    }
  }

  const outputs: ContentPipelineContext["outputs"] = {};
  for (const row of steps) {
    // The Analyse's row also holds the Faktenauszug; the prompts quote the Analyse without it.
    if (row.status === "done" || row.status === "waiting") outputs[row.step] = withoutPageFacts(row.output);
  }
  // Made before the Analyse and kept in its row whatever the row's status is.
  const pageFacts = readPageFacts(steps.find((row) => row.step === CONTENT_STEP_ANALYSE)?.output);

  const built: { context: ContentPipelineContext; avatarId: string | null } = {
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
      audience,
      typePrompts,
      texterPrompt,
      stepPrompts,
      notes: page.notes,
      contact,
      customerAnswers: customerAnswersFromPool(pool),
      knowledge: buildContentKnowledge({
        contact: contactData.data,
        pool,
        notes: page.notes,
        anbieterText: [...anbieter.sections.map((s) => s.current), ...(pageFacts?.facts ?? []).map((f) => f.fact)].join("\n"),
      }),
      pageFacts,
      wishes: {
        organisation: parseClientWishes(settingsRow.client_wishes),
        page: parseClientWishes(page.client_wishes),
      },
      freshness: page.freshness,
      openFindings: page.findings,
      keptFindings: readQuestionStop(page.question_stop).kept ?? [],
      outputs,
      blocks: parseBlocksFromHtml(page.html),
      title: page.title,
      metaDescription: page.meta_description,
    },
  };
  // „KUNDE PRÜFT“ answers (pool and notes): every step sees them with their placeholders.
  built.context.pendingChecks = built.context.knowledge?.pending ?? [];
  return built;
}

async function upsertStep(
  service: SupabaseClient,
  page: ContentPageRow,
  step: number,
  patch: Partial<ContentStepRow>,
): Promise<void> {
  const def = contentStepDefinition(step);
  const row = { page_id: page.id, organisation_id: page.organisation_id, step, name: def?.name ?? `Schritt ${step}`, ...patch };
  let { error } = await service.from("dt_content_steps").upsert(row, { onConflict: "page_id,step" });
  if (error && "stop_reason" in row && isMissingStopReasonColumnError(error)) {
    // Migration 20261111 not run yet: the step is saved without its stop_reason.
    const rest: Record<string, unknown> = { ...row };
    delete rest.stop_reason;
    ({ error } = await service.from("dt_content_steps").upsert(rest, { onConflict: "page_id,step" }));
  }
  if (error) throw new Error(contentDbErrorMessage(error, "Schritt konnte nicht gespeichert werden"));
}

type ModelCall = { json: unknown; usage: { inputTokens: number; outputTokens: number }; model: string; stopReason?: string | null };

/** `stop_reason` of the step's last call, for the step row. */
function lastStopReason(calls: readonly ModelCall[]): string | null {
  return calls[calls.length - 1]?.stopReason ?? null;
}

/**
 * After a step's patch: its company questions go into the organisation's pool, and the step row
 * records what the question rules did (asked, company, unasked, suppressed).
 */
async function settleQuestionPlan(
  service: SupabaseClient,
  page: ContentPageRow,
  patch: Pick<StepPatch, "firmaQuestions" | "questionPlan">,
  output: unknown,
): Promise<Record<string, unknown>> {
  if (patch.firmaQuestions?.length) await addOrgQuestions(service, page.organisation_id, page.slug, patch.firmaQuestions);
  const stored = (output && typeof output === "object" ? output : {}) as Record<string, unknown>;
  return patch.questionPlan ? { ...stored, question_plan: patch.questionPlan } : stored;
}

/** A text step's output with every „KUNDE PRÜFT“ placeholder of the previous text still in it. */
function keepPending(output: unknown, context: ContentPipelineContext): unknown {
  const blocks = (output as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocks) || !context.pendingChecks?.length) return output;
  const kept = keepPendingPlaceholders(blocks as ContentTextBlock[], context.blocks, context.pendingChecks);
  if (kept.restored.length > 0) console.warn("[content] KUNDE-PRÜFT-Platzhalter wiederhergestellt:", kept.restored);
  return { ...(output as Record<string, unknown>), blocks: kept.blocks };
}

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
  let output: unknown;
  try {
    output = spec.normalize(first.json, context);
  } catch (error) {
    // More Abschnitte than a text may have, or one that is too long: the step fails, nothing of
    // the answer is saved.
    if (error instanceof ContentTextLimitError) {
      throw new ContentLlmError(error.message, false, { stopReason: first.stopReason ?? null, outputTokens: first.usage.outputTokens });
    }
    throw error;
  }
  output = keepPending(output, context);
  const calls: ModelCall[] = [first];

  const hint = spec.retryHint?.(output) ?? null;
  const remaining = budget - (Date.now() - started);
  if (hint && remaining >= MIN_RETRY_MS) {
    try {
      const second = await invoke(`${spec.user}\n\n${hint}`, remaining);
      calls.push(second);
      const retried = keepPending(spec.normalize(second.json, context), context);
      const better = spec.score ? spec.score(retried) >= spec.score(output) : true;
      if (better) output = retried;
    } catch (error) {
      // The first attempt stands; a failed retry must not cost the step.
      console.warn("[content] retry inside step failed:", error instanceof Error ? error.message : error);
    }
  }
  return { output, calls };
}

/**
 * The step's refusal when the page's Zielgruppen do not fit into the prompt (profiles are never
 * shortened): a final error with the explanation, raised before any model call. Null when they fit.
 */
export function audienceBudgetError(context: Pick<ContentPipelineContext, "audience">): ContentLlmError | null {
  if (!context.audience) return null;
  const budget = audienceBudget(context.audience);
  return budget.over ? new ContentLlmError(audienceBudgetMessage(budget), false) : null;
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

  // Zielgruppen je Seite: a page without any gets the DigitalTwin's suggestion before the Analyse
  // and runs with it (unconfirmed is fine). A failure never stops the page: it runs with the
  // Standard-Zielgruppe as before. Without the migration (`zielgruppen` not read) nothing happens.
  if (def.step === CONTENT_STEP_ANALYSE && page.zielgruppen && !hasContentZielgruppen(page.zielgruppen)) {
    const suggested = await suggestContentZielgruppen(service, page, page.started_by).catch((error: unknown) => ({
      ok: false as const,
      status: 500,
      message: error instanceof Error ? error.message : String(error),
    }));
    if (suggested.ok) {
      page = { ...page, zielgruppen: suggested.zielgruppen, cost_eur: roundEur(num(page.cost_eur) + suggested.cost_eur) };
    } else {
      console.warn("[dt/content] Zielgruppen-Vorschlag vor der Analyse:", suggested.message);
    }
  }

  const { context, avatarId } = await loadContext(service, page, steps);
  // Profiles are never shortened: a Zielgruppen block over the limit stops the step before any
  // model call, with the explanation (which Zielgruppen, how long, what to do). Nothing is saved.
  const tooLong = audienceBudgetError(context);
  if (tooLong) throw tooLong;
  if (def.provider === "xai") {
    return runRephraseStep({ service, page, def, steps, context, avatarId, timeoutMs });
  }
  if (def.step === CONTENT_STEP_AKTUALITAET) {
    return runAktualitaetStep({ service, page, def, steps, context, avatarId, timeoutMs });
  }
  const models = await loadContentModelConfig(service);
  if (def.step === CONTENT_STEP_ANALYSE && !context.pageFacts) {
    // First the Faktenauszug from the conversations; the Analyse itself follows in the next turn.
    return runPageFactsPart({ service, page, def, context, avatarId, models: models[def.tier], timeoutMs });
  }
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

  // „Stoppen“, „Zurücksetzen“ or a new start while the model was answering: the cost is
  // recorded above, the result must not land on a page that is no longer this job's.
  if (!(await pageStillOurs(service, page))) {
    return { step, halted: true, discarded: true, model, costEur };
  }

  const patch = stepPatchFor(def, output, { ...page, knowledge: context.knowledge });
  const { pagePatch, stepStatus, halted } = patch;
  pagePatch.cost_eur = roundEur(num(page.cost_eur) + costEur);
  const settled = await settleQuestionPlan(service, page, patch, output);
  // The Analyse's row keeps the Faktenauszug made before it, and its tokens and cost.
  const facts = def.step === CONTENT_STEP_ANALYSE ? context.pageFacts ?? null : null;
  const storedOutput = facts ? { ...settled, page_facts: facts } : settled;

  await upsertStep(service, page, step, {
    status: stepStatus,
    output: storedOutput,
    model,
    input_tokens: usage.inputTokens + (facts?.input_tokens ?? 0),
    output_tokens: usage.outputTokens + (facts?.output_tokens ?? 0),
    cost_eur: roundEur(costEur + (facts?.cost_eur ?? 0)),
    error: null,
    stop_reason: lastStopReason(calls),
    finished_at: new Date().toISOString(),
  });
  const { error } = await service.from("dt_content_pages").update(pagePatch).eq("id", page.id);
  if (error) throw new Error(`Seite konnte nicht gespeichert werden: ${error.message}`);

  return { step, halted, model, costEur };
}

/**
 * The first part of the Analyse step: the page's Faktenauszug (`page-facts.ts`). One call reads
 * all conversations of the organisation and keeps what they say about this page's topic; the
 * result is saved in the step row and the step hands back `partial`, so the Analyse runs in the
 * next loop turn with its own time. Without conversations no call is made, and none while the
 * Anbieter evaluation is not approved or older than a conversation (the page window says why). A call the job can
 * try again (overload, time limit) fails the step like any other; one it cannot (a refused
 * request, a cut-off answer) does not stop the page: it runs with the Anbieter sections alone,
 * as before, and the page window says that the excerpt is missing and why.
 */
export async function runPageFactsPart(input: {
  service: SupabaseClient;
  page: ContentPageRow;
  def: ContentStepDefinition;
  context: ContentPipelineContext;
  avatarId: string | null;
  models: string[];
  timeoutMs: number | undefined;
  /** Tests hand in a stub; no network. */
  callTool?: typeof callContentTool;
}): Promise<StepOutcome> {
  const { service, page, def, context } = input;
  let sources: WorkshopSource[] = [];
  let evaluation: Array<{ label: string; current: string }> = [];
  let status: WorkshopSectionStatus = "empty";
  let loadError: string | null = null;
  try {
    const state = await loadWorkshopState(service, page.organisation_id);
    sources = state.sources;
    evaluation = state.anbieter.items.map((item) => ({ label: item.label, current: item.current }));
    status = state.anbieter.status;
  } catch (error) {
    loadError = `Die Gespräche konnten nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`;
  }
  const blocked = extractBlockedStatements(evaluation);
  const skipReason = sources.length > 0 ? evaluationSkipReason(status) : null;

  let facts: ContentPageFacts;
  let model = "";
  if (sources.length === 0) {
    facts = emptyPageFacts({ conversations: 0, error: loadError, blocked });
  } else if (skipReason) {
    // Not approved or older than a conversation: nothing is pulled from unchecked conversations.
    facts = emptyPageFacts({ conversations: sources.length, skipped: skipReason, blocked });
  } else {
    const prompt = pageFactsPrompt(context, sources, evaluation);
    try {
      const call = await (input.callTool ?? callContentTool)({
        models: input.models,
        system: prompt.system,
        user: prompt.user,
        tool: prompt.tool,
        maxTokens: prompt.maxTokens,
        timeoutMs: input.timeoutMs,
      });
      model = call.model;
      const costEur = roundEur(estimateCostEur(call.model, call.usage));
      await recordLlmUsageEvent(service, {
        organisationId: page.organisation_id,
        userId: page.started_by,
        agentId: input.avatarId,
        mode: PAGE_FACTS_USAGE_MODE,
        via: "direct",
        model: call.model,
        inputTokens: call.usage.inputTokens,
        outputTokens: call.usage.outputTokens,
      });
      facts = pageFactsFromCall({ json: call.json, conversations: sources.length, shortened: prompt.shortened, model: call.model, usage: call.usage, costEur, blocked });
    } catch (error) {
      // Overload, rate limit, time limit: the job tries the step again, like every other call.
      if (error instanceof ContentLlmError && error.retryable) throw error;
      console.warn("[content] Faktenauszug failed:", error instanceof Error ? error.message : error);
      facts = emptyPageFacts({ conversations: sources.length, error: error instanceof Error ? error.message : String(error), blocked });
    }
  }

  if (!(await pageStillOurs(service, page))) {
    return { step: def.step, halted: true, discarded: true, model, costEur: facts.cost_eur };
  }
  await upsertStep(service, page, def.step, {
    status: "pending",
    output: { page_facts: facts },
    model: model || null,
    input_tokens: facts.input_tokens,
    output_tokens: facts.output_tokens,
    cost_eur: facts.cost_eur,
    error: null,
    finished_at: null,
  });
  if (facts.cost_eur > 0) {
    const { error } = await service
      .from("dt_content_pages")
      .update({ cost_eur: roundEur(num(page.cost_eur) + facts.cost_eur) })
      .eq("id", page.id);
    if (error) throw new Error(contentDbErrorMessage(error, "Seite konnte nicht gespeichert werden"));
  }
  return { step: def.step, halted: false, partial: true, model, costEur: 0 };
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
      if (progress.calls > billedBefore && (await pageStillOurs(service, page))) {
        await saveProgress().catch((err) => console.error("[content] research cost not stored", err));
      }
      throw error;
    }
    if (!(await pageStillOurs(service, page))) {
      return { step: def.step, halted: true, discarded: true, model, costEur: progress.cost_eur };
    }
    const inspection = inspectResearchBlocks(result.blocks);
    const research = researchFromCall(result.text, inspection, {
      searches: result.calls.reduce((sum, call) => sum + call.web.webSearchRequests, 0),
      fetches: result.calls.reduce((sum, call) => sum + call.web.webFetchRequests, 0),
    });
    const problem = researchProblem(research, inspection);
    if (problem) console.warn("[content] research not usable, protocol:", research.text.slice(0, 1500));
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
  let stopReason: string | null = null;
  if (aktualitaetNeedsNoResult(research)) {
    output = unchangedAktualitaetOutput(context, research);
  } else {
    const spec = aktualitaetWriteSpec(context, research);
    const { output: written, calls } = await callStep(spec, context, models, Math.max(30_000, deadline - Date.now()));
    for (const call of calls) await bill(call);
    output = written as AktualitaetOutput;
    stopReason = lastStopReason(calls);
  }

  if (!(await pageStillOurs(service, page))) {
    return { step: def.step, halted: true, discarded: true, model, costEur: progress.cost_eur };
  }

  // With GEO switched off the Faktencheck's findings are still open; the patch keeps them.
  const faktencheck = context.outputs[CONTENT_STEP_FAKTENCHECK] as Partial<FaktencheckOutput> | undefined;
  const patch = stepPatchFor(def, output, {
    ...page,
    knowledge: context.knowledge,
    faktencheck_findings: Array.isArray(faktencheck?.findings) ? faktencheck.findings : [],
  });
  const { pagePatch, stepStatus, halted, resetFrom } = patch;
  pagePatch.cost_eur = roundEur(num(page.cost_eur) + progress.cost_eur);
  const storedOutput = await settleQuestionPlan(service, page, patch, output);
  await upsertStep(service, page, def.step, {
    status: stepStatus,
    output: storedOutput,
    model,
    input_tokens: progress.input_tokens,
    output_tokens: progress.output_tokens,
    cost_eur: progress.cost_eur,
    error: null,
    stop_reason: stopReason,
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

/**
 * Stopped, reset or started again while the model was answering? Then this worker saves
 * nothing more for the page: it must still run, and still under this worker's job
 * (`page.job_id` as the step loop adopted it). „Stoppen“ ends the job but not the model call
 * in flight; when the page was started again meanwhile, the new job owns it. A read error
 * counts as yes, as before: the save itself then fails visibly.
 */
export async function pageStillOurs(
  service: SupabaseClient,
  page: Pick<ContentPageRow, "id" | "job_id">,
): Promise<boolean> {
  const { data, error } = await service.from("dt_content_pages").select("state, job_id").eq("id", page.id).maybeSingle();
  if (error) return true;
  return data?.state === "laeuft" && (page.job_id == null || data.job_id === page.job_id);
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
    // A section Grok gives no text for keeps its wording and becomes an open point (31.10.).
    keepOnEmpty: true,
    // Numbers, placeholders, names and keywords stay; a section that loses one keeps its wording.
    guard: { terms: rephraseProtectedTerms(context) },
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
    stillWanted: () => pageStillOurs(service, page),
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
  // Watermark Entfernung writes text but is no gap-checked step: no question plan here.
  const { pagePatch, stepStatus, halted } = stepPatchFor(def, output, { ...page, knowledge: context.knowledge });
  if (progress.kept?.length) {
    const names = new Map(context.blocks.map((b) => [b.id, b.heading?.trim() || b.id]));
    pagePatch.findings = [
      ...page.findings,
      ...progress.kept.map((k) => ({
        title: "Abschnitt nicht umformuliert",
        problem: `Grok hat für den Abschnitt „${names.get(k.block_id) ?? k.block_id}“ keinen Text geliefert (auch einzeln und mit den anderen Grok-Modellen). Er steht so da, wie das Lektorat ihn gelassen hat. ${k.reason}`.trim(),
        proposal: "Abschnitt so lassen oder von Hand umformulieren (Abschnitt ändern).",
        severity: "low",
        severity_label: "Hinweis",
        block_id: k.block_id,
      })),
    ];
  }
  if (progress.rejected?.length) {
    pagePatch.findings = [...((pagePatch.findings as ContentFinding[] | undefined) ?? page.findings), ...rephraseRejectedFindings(progress.rejected, context.blocks)];
  }
  pagePatch.cost_eur = roundEur(num(page.cost_eur) + progress.cost_eur);
  await saveProgress(run.model, { status: stepStatus, finished_at: new Date().toISOString() });
  const { error } = await service.from("dt_content_pages").update(pagePatch).eq("id", page.id);
  if (error) throw new Error(`Seite konnte nicht gespeichert werden: ${error.message}`);
  return { step: def.step, halted, model: run.model, costEur: progress.cost_eur };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * SEO switched off on a crawl page: the live page as the text tools read it (live HTML with
 * headings, else the stored crawl text). On a page with an uploaded Word file: that file's
 * sections, no fetch and no website needed. Any failure is final for this attempt: the page
 * pauses with the reason instead of going on without a text.
 */
async function loadLiveText(
  service: SupabaseClient,
  page: ContentPageRow,
  fetchImpl: FetchLike | undefined,
): Promise<LiveTextImport> {
  if (page.source === "upload") {
    const upload = await loadPageTextUpload(service, page);
    if (!upload) throw new ContentLlmError(uploadTextFailureMessage("Zur Seite gibt es keine lesbare Word-Datei (mehr)"), false);
    return {
      source: "upload",
      url: null,
      file: upload.file_name,
      ingested: { blocks: upload.blocks, title: upload.title, metaDescription: upload.meta_description },
    };
  }
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
  if (!(await pageStillOurs(service, page))) {
    return { step, halted: true, discarded: true, skipped: true, model: "", costEur: 0 };
  }

  const row = steps.find((s) => s.step === step);
  const { stepRow, pagePatch, halted } = skippedStepPatch(def, page, { live, paidBefore: num(row?.cost_eur), now: options.now });
  await upsertStep(service, page, step, stepRow);
  const { error } = await service.from("dt_content_pages").update(pagePatch).eq("id", page.id).eq("state", "laeuft");
  if (error) throw new Error(contentDbErrorMessage(error, "Seite konnte nicht gespeichert werden"));
  return { step, halted, skipped: true, model: "", costEur: 0 };
}

/** What a failed model call left for the step's log: why it stopped and how much it had written. */
export type StepFailureDetail = { stopReason?: string | null; outputTokens?: number | null };

/** The log fields of a failed call as the error carries them (`ContentLlmError`); empty for other errors. */
export function stepFailureDetail(error: unknown): StepFailureDetail {
  if (!(error instanceof ContentLlmError)) return {};
  return { stopReason: error.stopReason, outputTokens: error.outputTokens };
}

function failurePatch(detail: StepFailureDetail): Partial<ContentStepRow> {
  return {
    ...(detail.stopReason ? { stop_reason: detail.stopReason } : {}),
    ...(detail.outputTokens != null ? { output_tokens: detail.outputTokens } : {}),
  };
}

/**
 * Pause the page with the error visible in the table and drawer. Not when the page is no
 * longer this job's (stopped, or started again under a new job): the failure of a stopped
 * worker must not pause the new run.
 */
export async function markContentStepError(
  service: SupabaseClient,
  page: ContentPageRow,
  step: number,
  message: string,
  detail: StepFailureDetail = {},
): Promise<void> {
  if (!(await pageStillOurs(service, page))) return;
  const text = message.slice(0, 500);
  await upsertStep(service, page, step, {
    status: "error",
    error: text,
    finished_at: new Date().toISOString(),
    ...failurePatch(detail),
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
  detail: StepFailureDetail = {},
): Promise<void> {
  if (!(await pageStillOurs(service, page))) return;
  const text = message.slice(0, 500);
  await upsertStep(service, page, step, {
    status: "pending",
    error: text,
    finished_at: new Date().toISOString(),
    ...failurePatch(detail),
  }).catch((err) => console.error("[content] step retry not stored", err));
  await service
    .from("dt_content_pages")
    .update({ step, error: text })
    .eq("id", page.id)
    .eq("state", "laeuft");
}

// --- the page's one stop for questions, before the Watermark Entfernung ----------------------------

export type QuestionStopOutcome = {
  /** ask: the page stopped as „Braucht Sie“; pass: answers were worked in; go_on: nothing to do. */
  action: "ask" | "pass" | "go_on";
  halted: boolean;
  discarded?: boolean;
  /** The pass needs a model call and the job's budget is too short: nothing changed, next tick. */
  deferred?: boolean;
  model: string;
  costEur: number;
};

/**
 * The stop (`question-stop.ts`): what only the customer knows stops the page once, with one
 * merged list; known answers and the customer's answers go through the short pass
 * „Antworten einarbeiten“ (`answers.ts`, usage `content.answers`, cost on the page and in
 * `question_stop.pass`, no step row). Afterwards the run goes on with the Watermark Entfernung.
 */
export async function runQuestionStop(
  service: SupabaseClient,
  page: ContentPageRow,
  steps: ContentStepRow[],
  timeoutMs?: number,
  options: { callTool?: typeof callContentTool; now?: Date; context?: ContentPipelineContext; models?: string[] } = {},
): Promise<QuestionStopOutcome> {
  const at = (options.now ?? new Date()).toISOString();
  // Tests hand in the context (the loader reads the survey service); the job always loads it fresh.
  const { context, avatarId } = options.context ? { context: options.context, avatarId: null } : await loadContext(service, page, steps);
  const knowledge = context.knowledge ?? buildContentKnowledge({});
  const stop = readQuestionStop(page.question_stop);
  const blocks = parseBlocksFromHtml(page.html);
  const decisions = stop.handled.filter((h) => h.source === "kunde");
  const plan = planQuestionStop({ blocks, questions: page.questions, knowledge, decisions, slug: page.slug });

  if (stop.status !== "answered") {
    const outcome = questionStopOutcome(plan);
    if (outcome === "ask") {
      if (plan.newFirma.length > 0) await addOrgQuestions(service, page.organisation_id, page.slug, plan.newFirma);
      if (!(await pageStillOurs(service, page))) return { action: "ask", halted: true, discarded: true, model: "", costEur: 0 };
      const { error } = await service
        .from("dt_content_pages")
        .update({
          state: "braucht_sie",
          job_id: null,
          questions: plan.ask,
          question_stop: { ...questionStopKeep(stop, { keepKept: true }), status: "waiting", at, asked: plan.ask.length + plan.askPool.length + plan.newFirma.length, handled: plan.handled },
        })
        .eq("id", page.id);
      if (error) throw new Error(contentDbErrorMessage(error, "Seite konnte nicht gespeichert werden"));
      return { action: "ask", halted: true, model: "", costEur: 0 };
    }
    if (outcome === "go_on") {
      const { error } = await service
        .from("dt_content_pages")
        .update({ questions: [], question_stop: { ...questionStopKeep(stop, { keepKept: true }), status: "done", at, asked: 0, handled: [] } })
        .eq("id", page.id)
        .eq("state", "laeuft");
      if (error) throw new Error(contentDbErrorMessage(error, "Seite konnte nicht gespeichert werden"));
      return { action: "go_on", halted: false, model: "", costEur: 0 };
    }
  }

  // „Antworten einarbeiten“: drops in code, answers through one short call on the affected Abschnitte.
  // Page questions never asked (over the limit) go like „Ohne Angabe weiter“.
  const handled = questionStopPassItems(plan);
  const dropped = applyDrops(blocks, handled);
  const forModel = [...handled.filter((h) => h.action === "answer" && h.answer), ...dropped.unresolved];
  const targets = answerTargets(dropped.blocks, forModel);
  let result = { blocks: dropped.blocks, changed: dropped.changed, fallback: [] as string[], rejected: [] as Array<{ block_id: string; reason: string }> };
  let costEur = 0;
  let model = "";
  let usage = { inputTokens: 0, outputTokens: 0 };
  if (targets.size > 0 && timeoutMs != null && timeoutMs < ANSWERS_MIN_MS) {
    // Nothing is saved yet: the next tick evaluates the stop again and has the time for the call.
    return { action: "pass", halted: false, deferred: true, model: "", costEur: 0 };
  }
  if (targets.size > 0) {
    const targetBlocks = dropped.blocks.filter((b) => targets.has(b.id));
    const prompt = answersPassPrompt(context, targetBlocks, forModel);
    const models = options.models ?? (await loadContentModelConfig(service)).write;
    const call = await (options.callTool ?? callContentTool)({
      models,
      system: prompt.system,
      user: prompt.user,
      tool: ANSWERS_TOOL,
      maxTokens: ANSWERS_MAX_TOKENS,
      timeoutMs: timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
    });
    model = call.model;
    usage = call.usage;
    costEur = estimateCostEur(call.model, call.usage);
    await recordLlmUsageEvent(service, {
      organisationId: page.organisation_id,
      userId: page.started_by,
      agentId: avatarId,
      mode: ANSWERS_USAGE_MODE,
      via: "direct",
      model: call.model,
      inputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
    });
    const normalized = normalizeAnswersOutput(call.json, { blocks: dropped.blocks, targets });
    result = { ...normalized, changed: [...new Set([...dropped.changed, ...normalized.changed])] };
  }
  if (!(await pageStillOurs(service, page))) return { action: "pass", halted: true, discarded: true, model, costEur };

  const html = renderBlocksHtml(result.blocks);
  const answerNotes = handled
    .filter((h) => h.source === "kunde")
    .map((h) => customerAnswerNote(h.question, h.action === "answer" ? h.answer : null));
  const { error } = await service
    .from("dt_content_pages")
    .update({
      html,
      markdown: htmlToMarkdown(html),
      questions: [],
      notes: answerNotes.length > 0 ? [...page.notes, answerNotes.join("\n")].slice(-20) : page.notes,
      cost_eur: roundEur(num(page.cost_eur) + costEur),
      question_stop: {
        ...questionStopKeep(stop, { keepKept: true }),
        status: "done",
        at,
        asked: stop.asked ?? 0,
        handled,
        pass: {
          at,
          cost_eur: roundEur(costEur),
          model: model || null,
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          changed: result.changed,
          fallback: result.fallback,
          rejected: result.rejected,
        },
      },
    })
    .eq("id", page.id);
  if (error) throw new Error(contentDbErrorMessage(error, "Seite konnte nicht gespeichert werden"));
  return { action: "pass", halted: false, model, costEur };
}
