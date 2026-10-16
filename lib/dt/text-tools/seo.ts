/**
 * The standalone SEO tool (Verwaltung → SEO): step 2 „SEO“ of the Texte pipeline once for a
 * page that has no row in `dt_content_pages`. The briefing comes from a form (page name and
 * type, optional Hauptsilo, keywords, H1 options, questions, link targets, KI-Prompt, notes)
 * and an optional upload (.txt, .html, .pdf, .docx) that stands in for the live page text.
 * Prompt, tool schema, model tier, Textvorlagen and the hero placeholder are the pipeline's
 * (`lib/dt/content/pipeline/prompts.ts`, step 2 via `contentStepSpec`).
 *
 * Step 2 writes from the Analyse (step 1). Without a pasted Analyse JSON the run makes two
 * calls in one job — the pipeline's own step 1 first, then step 2 — so the text has the same
 * main question, fan-out questions and Hormozi fields a Texte page gets. The Analyse is
 * stored on the job row between the two calls (`result.analyse`); a tick that runs out of
 * budget after step 1, or a retry after a model error in step 2, continues with it.
 *
 * `buildSeoToolContext`, `seoToolAnalyseSpec`, `seoToolSpec` and the parsing helpers are
 * pure; `runSeoTextTool` loads the organisation's Texte context and calls Claude (injectable
 * for tests).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  loadContentAnbieterSources,
  loadContentAvatarOptions,
  loadContentAvatarRow,
} from "@/lib/dt/content/load-sources";
import { avatarFromAgent, type ContentTextSettings, type WorkshopAnbieterSection } from "@/lib/dt/content/mapping";
import { loadContentModelConfig } from "@/lib/dt/content/model-config-db";
import { CONTENT_PAGE_TYPE_LABELS, type ContentPageType } from "@/lib/dt/content/page-types";
import { ContentLlmError, callContentTool } from "@/lib/dt/content/pipeline/llm";
import {
  MAX_STANDALONE_MATERIAL_CHARS,
  contentStepSpec,
  normalizeAnalyse,
  type AnalyseOutput,
  type ContentPipelineContext,
  type ContentStepSpec,
  type TextOutput,
} from "@/lib/dt/content/pipeline/prompts";
import { CONTENT_STEP_ANALYSE, CONTENT_STEP_SEO } from "@/lib/dt/content/pipeline/steps";
import { estimateCostEur, roundEur } from "@/lib/dt/content/pricing";
import { htmlToPlainText, renderBlocksHtml, type ContentTextBlock } from "@/lib/dt/content/render";
import { loadContentSettings, settingsFromRow } from "@/lib/dt/content/store";
import { loadContentStepPrompts, type ContentStepPrompts } from "@/lib/dt/content/step-prompts";
import { loadTexterPrompt } from "@/lib/dt/content/texter-prompt";
import { loadContentTypePromptsForRun } from "@/lib/dt/content/type-prompts-db";
import type { ContentTypePrompts } from "@/lib/dt/content/type-prompts";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";

/** `jobs.kind` of a run and the `mode` of its usage events (both calls). */
export const SEO_TOOL_JOB_KIND = "text-tool.seo";
export const SEO_TOOL_USAGE_MODE = "text-tool.seo";

/** The page types the dropdown offers („Nicht bearbeiten“ has no Textvorlage and no text). */
export const SEO_TOOL_PAGE_TYPES = ["hauptsilo", "hauptseite", "unterseite", "ratgeber", "standort", "startseite", "ueber_uns"] as const satisfies readonly ContentPageType[];
export type SeoToolPageType = (typeof SEO_TOOL_PAGE_TYPES)[number];

export const SEO_TOOL_MAX_NOTES_CHARS = 4_000;
export const SEO_TOOL_MAX_NOTES = 20;
/** One textarea of keywords, H1 options, questions or link targets. */
export const SEO_TOOL_MAX_LIST_CHARS = 4_000;
export const SEO_TOOL_MAX_KI_PROMPT_CHARS = 2_000;
export const SEO_TOOL_MAX_ANALYSE_CHARS = 20_000;
/** The uploaded material as plain text; longer uploads are clipped here, not refused. */
export const SEO_TOOL_MAX_MATERIAL_CHARS = MAX_STANDALONE_MATERIAL_CHARS;

export function isSeoToolPageType(value: unknown): value is SeoToolPageType {
  return typeof value === "string" && (SEO_TOOL_PAGE_TYPES as readonly string[]).includes(value);
}

/** What the run route stores on the job; the handler reads it back on every tick. */
export const seoToolPayloadSchema = z.object({
  organisationId: z.string().uuid(),
  userId: z.string().uuid(),
  /** Label for the prompt and the export's file name; never a database key. */
  pageName: z.string().min(1).max(200),
  pageType: z.enum(SEO_TOOL_PAGE_TYPES),
  pillarName: z.string().max(200).nullable(),
  mainKeyword: z.string().max(120).nullable(),
  secondaryKeywords: z.array(z.string().max(120)).max(15),
  h1Options: z.array(z.string().max(200)).max(10),
  userQuestions: z.array(z.string().max(400)).max(40),
  linkTargets: z.array(z.string().max(200)).max(40),
  kiPrompt: z.string().max(SEO_TOOL_MAX_KI_PROMPT_CHARS).nullable(),
  /** Redaktionelle Anmerkungen; one note per paragraph. */
  notes: z.array(z.string().max(SEO_TOOL_MAX_NOTES_CHARS)).max(SEO_TOOL_MAX_NOTES),
  /** The upload's name, null without one. */
  fileName: z.string().min(1).max(260).nullable(),
  /** The upload as plain text (headings as Markdown lines), null without one. */
  material: z.string().max(SEO_TOOL_MAX_MATERIAL_CHARS + 100).nullable(),
  /** A pasted Analyse result (step 1 JSON); null when the run derives it itself. */
  analyse: z.unknown().nullable(),
});

export type SeoToolPayload = z.infer<typeof seoToolPayloadSchema>;

export type SeoToolAnalyseSource = "pasted" | "model";

export type SeoToolResult = {
  blocks: ContentTextBlock[];
  title: string | null;
  meta_description: string | null;
  /** The blocks rendered as the stored page HTML (`<section data-block-id>`), for preview and export. */
  html: string;
  /** The Analyse the text was written from (pasted or derived in the same job). */
  analyse: AnalyseOutput;
  analyse_source: SeoToolAnalyseSource;
  /** The model of the SEO call; `models` lists every model that answered. */
  model: string;
  models: string[];
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_eur: number;
  page_name: string;
  page_type: SeoToolPageType;
  file_name: string | null;
};

/** What the job row's `result` holds after the Analyse while the SEO call is still open. */
export type SeoToolProgress = {
  analyse: AnalyseOutput;
  analyse_source: SeoToolAnalyseSource;
  models: string[];
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_eur: number;
};

/** What the status route hands the browser. */
export type SeoToolJob = {
  state: "running" | "done" | "error";
  /** „Analyse fertig, Seitentext wird geschrieben“ once step 1 is stored; null before. */
  progress: string | null;
  result: SeoToolResult | null;
  error: string | null;
};

export type SeoToolStartResult = {
  id: string;
  status_url: string;
  /** What was read from the upload (null without one), so the UI can show it while the model works. */
  input: { blocks: number; chars: number; format: string } | null;
  /** Whether the job starts with the pasted Analyse or derives one first. */
  analyse_source: SeoToolAnalyseSource;
};

/** Everything the context builder needs; the loader fills it from the database. */
export type SeoToolContextInput = {
  organisationName: string;
  sections: WorkshopAnbieterSection[];
  settings: ContentTextSettings;
  avatar: { name: string; role: string; beschreibung: string } | null;
  typePrompts: ContentTypePrompts;
  /** General Texter rules. Omitted in tests: the SEO step then uses the code default. */
  texterPrompt?: string;
  /** Step instructions from Globale Prompts (this tool reads the SEO one). Omitted: the defaults. */
  stepPrompts?: Partial<ContentStepPrompts>;
  payload: Omit<SeoToolPayload, "organisationId" | "userId">;
};

// --- input parsing (textarea → lists) ---------------------------------------------------------

function cleanLine(line: string, max: number): string {
  return line.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, "").trim().slice(0, max);
}

/** Textarea → one entry per line, leading bullets and numbers dropped, duplicates removed. */
export function splitSeoLines(text: string | null | undefined, options: { max: number; maxChars: number }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of (text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = cleanLine(raw, options.maxChars);
    const key = line.toLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= options.max) break;
  }
  return out;
}

/** Input „a, b; c“ or one per line → keywords, at most 15, each at most 120 characters. */
export function splitSeoKeywords(text: string | null | undefined): string[] {
  const joined = (text ?? "").replace(/\r\n?/g, "\n").replace(/[;\n]/g, ",");
  return splitSeoLines(joined.split(",").join("\n"), { max: 15, maxChars: 120 });
}

/** Textarea → notes: paragraphs separated by a blank line, at most 20. */
export function splitSeoNotes(text: string | null | undefined): string[] {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((n) => n.trim().slice(0, SEO_TOOL_MAX_NOTES_CHARS))
    .filter(Boolean)
    .slice(0, SEO_TOOL_MAX_NOTES);
}

/** Pasted Analyse JSON → object; a message when it is not JSON. Empty input is „none“. */
export function parseAnalyseJson(text: string | null | undefined): { ok: true; value: unknown | null } | { ok: false; message: string } {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > SEO_TOOL_MAX_ANALYSE_CHARS) {
    return { ok: false, message: `Das Analyse-JSON ist zu lang (max. ${SEO_TOOL_MAX_ANALYSE_CHARS.toLocaleString("de-DE")} Zeichen).` };
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed) as unknown;
  } catch {
    return { ok: false, message: "Das Analyse-Feld enthält kein gültiges JSON." };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Das Analyse-JSON muss ein Objekt mit „main_question“ und „fanout_questions“ sein." };
  }
  const r = value as Record<string, unknown>;
  if (typeof r.main_question !== "string" && !Array.isArray(r.fanout_questions)) {
    return { ok: false, message: "Das Analyse-JSON muss ein Objekt mit „main_question“ und „fanout_questions“ sein." };
  }
  return { ok: true, value };
}

/**
 * The upload as the prompt reads it: headings as Markdown lines, the body as plain text,
 * clipped to the material limit (the ingest refuses longer texts up front anyway).
 */
export function materialTextFromBlocks(blocks: readonly ContentTextBlock[]): string | null {
  const text = blocks
    .map((b) => {
      const heading = b.heading ? `${"#".repeat(b.level)} ${b.heading}\n` : "";
      return `${heading}${htmlToPlainText(b.html)}`.trim();
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!text) return null;
  return text.length > SEO_TOOL_MAX_MATERIAL_CHARS ? `${text.slice(0, SEO_TOOL_MAX_MATERIAL_CHARS)}\n[… gekürzt]` : text;
}

// --- context ---------------------------------------------------------------------------------

/** The level the prompt reports (0 = Startseite): a Hauptsilo sits on level 1, everything else below it. */
function levelFor(pageType: SeoToolPageType): number {
  return pageType === "hauptsilo" || pageType === "hauptseite" ? 1 : 2;
}

function keywordsFor(payload: SeoToolContextInput["payload"]): ContentPipelineContext["page"]["keywords"] {
  const main = payload.mainKeyword?.trim();
  if (!main) return null;
  const secondary = payload.secondaryKeywords
    .map((k) => k.trim())
    .filter((k) => k && k.toLowerCase() !== main.toLowerCase())
    .map((text) => ({ text }));
  return { main: { text: main }, secondary };
}

/**
 * The KI-Prompt line of the page. Nebenkeywords without a Hauptkeyword have no place in
 * the keywords field (the type needs a main keyword), so they ride along here as an
 * instruction, and the Analyse derives the Hauptkeyword.
 */
function kiPromptFor(payload: SeoToolContextInput["payload"]): string | null {
  const parts: string[] = [];
  const prompt = payload.kiPrompt?.trim();
  if (prompt) parts.push(prompt);
  if (!payload.mainKeyword?.trim() && payload.secondaryKeywords.length > 0) {
    parts.push(`Nebenkeywords aus dem Briefing (das Hauptkeyword leitet die Analyse ab): ${payload.secondaryKeywords.join(", ")}`);
  }
  return parts.length > 0 ? parts.join("\n").slice(0, SEO_TOOL_MAX_KI_PROMPT_CHARS + 400) : null;
}

/**
 * The pipeline context for a page that exists only in this run: the same shape step 1 and
 * step 2 read for a Texte page, with the form as briefing, the upload as „bisheriger Text“,
 * no other pages, no current text. A pasted Analyse lands normalised in `outputs[1]`.
 */
export function buildSeoToolContext(input: SeoToolContextInput): ContentPipelineContext {
  const { payload } = input;
  const context: ContentPipelineContext = {
    organisationName: input.organisationName,
    page: {
      name: payload.pageName.trim(),
      path: null,
      level: levelFor(payload.pageType),
      url: null,
      source: "standalone",
      page_role: null,
      page_type: payload.pageType,
      pillar_name: payload.pillarName?.trim() || null,
      estimated_traffic: null,
      keywords: keywordsFor(payload),
      h1_options: payload.h1Options.map((h) => h.trim()).filter(Boolean),
      user_questions: payload.userQuestions.map((q) => q.trim()).filter(Boolean),
      ki_prompt: kiPromptFor(payload),
      internal_link_targets: payload.linkTargets.map((t) => t.trim()).filter(Boolean),
    },
    structureOutline: "",
    existingText: payload.material?.trim() || null,
    sections: input.sections,
    settings: input.settings,
    avatar: input.avatar,
    typePrompts: input.typePrompts,
    texterPrompt: input.texterPrompt,
    stepPrompts: input.stepPrompts,
    notes: payload.notes,
    outputs: {},
    blocks: [],
    title: null,
    metaDescription: null,
  };
  if (payload.analyse != null) {
    context.outputs[CONTENT_STEP_ANALYSE] = normalizeAnalyse(payload.analyse, context);
  }
  return context;
}

/** The context with this Analyse as the output of step 1 (what step 2 reads). */
export function withSeoToolAnalyse(context: ContentPipelineContext, analyse: AnalyseOutput): ContentPipelineContext {
  return { ...context, outputs: { ...context.outputs, [CONTENT_STEP_ANALYSE]: analyse } };
}

/** The pasted Analyse, normalised, or null when the run has to derive one. */
export function pastedSeoToolAnalyse(context: ContentPipelineContext): AnalyseOutput | null {
  return (context.outputs[CONTENT_STEP_ANALYSE] as AnalyseOutput | undefined) ?? null;
}

/** Step 1 of the pipeline for this page: same prompt, same tool, same normalisation. */
export function seoToolAnalyseSpec(context: ContentPipelineContext): ContentStepSpec {
  return contentStepSpec(CONTENT_STEP_ANALYSE, context);
}

/** Step 2 of the pipeline for this page; `context.outputs[1]` must hold the Analyse. */
export function seoToolSpec(context: ContentPipelineContext): ContentStepSpec {
  return contentStepSpec(CONTENT_STEP_SEO, context);
}

/**
 * Loads what the Texte pipeline loads for a page (confirmed settings, Anbieterfakten, the
 * configured or newest avatar, the agency's Textvorlagen) and builds the context around the
 * briefing. Settings and Anbieterfakten are required like in the pipeline: step 2 writes
 * facts, and without any it would only write placeholders.
 */
export async function loadSeoToolContext(service: SupabaseClient, payload: SeoToolPayload): Promise<{ context: ContentPipelineContext; avatarId: string | null }> {
  const [{ data: organisation }, settingsRow, anbieter, typePrompts, texterPrompt, stepPrompts] = await Promise.all([
    service.from("organisations").select("name").eq("id", payload.organisationId).maybeSingle(),
    loadContentSettings(service, payload.organisationId),
    loadContentAnbieterSources(service, payload.organisationId),
    loadContentTypePromptsForRun(service),
    loadTexterPrompt(service),
    loadContentStepPrompts(service),
  ]);
  if (!settingsRow) {
    throw new ContentLlmError("Die Einstellungen für Texte sind für diese Organisation noch nicht bestätigt. Bitte zuerst unter Texte bestätigen.", false);
  }
  if (anbieter.sections.length === 0) {
    throw new ContentLlmError("Keine Anbieterfakten vorhanden (weder Anbieter-Fragebogen noch ausgewertete Gespräche).", false);
  }

  let avatarId = settingsRow.avatar_agent_id;
  if (!avatarId) {
    const [newest] = await loadContentAvatarOptions(service, payload.organisationId);
    avatarId = newest?.id ?? null;
  }
  const avatarRow = avatarId ? await loadContentAvatarRow(service, payload.organisationId, avatarId) : null;
  const avatar = avatarRow ? avatarFromAgent(avatarRow) : null;

  return {
    avatarId: avatarRow?.id ?? null,
    context: buildSeoToolContext({
      organisationName: (organisation?.name as string | undefined)?.trim() || "",
      sections: anbieter.sections,
      settings: settingsFromRow(settingsRow),
      avatar: avatar ? { name: avatar.name, role: avatar.role, beschreibung: avatar.beschreibung } : null,
      typePrompts,
      texterPrompt,
      stepPrompts,
      payload,
    }),
  };
}

// --- the run -----------------------------------------------------------------------------------

export type SeoToolModelCall = (input: {
  models: string[];
  system: string;
  user: string;
  tool: ContentStepSpec["tool"];
  maxTokens: number;
  timeoutMs?: number;
}) => Promise<{ json: unknown; usage: { inputTokens: number; outputTokens: number }; model: string }>;

export type SeoToolRunOutcome =
  /** The Analyse is done but the budget does not carry the SEO call; `progress` is what the handler stores and reschedules with. */
  | { state: "partial"; progress: SeoToolProgress }
  | { state: "done"; result: SeoToolResult };

export type SeoToolRunOptions = {
  timeoutMs?: number;
  /** The job row's `result` from the previous tick (or null on the first). */
  previous?: unknown;
  /** Stores the Analyse as soon as it is answered, so a retry of the SEO call does not pay for it twice. */
  saveProgress?: (progress: SeoToolProgress) => Promise<void>;
  /** Usage of one answered call; production records a usage event. */
  recordUsage?: (usage: { model: string; inputTokens: number; outputTokens: number }) => Promise<void>;
  models?: { write: string[] };
  call?: SeoToolModelCall;
  now?: () => number;
};

const DEFAULT_TIMEOUT_MS = 240_000;
/** Step 1 answers in about a minute; this is the most of the budget it may take. */
const ANALYSE_TIMEOUT_MS = 120_000;
/** The SEO call writes up to 12.000 tokens; with less than this left it waits for the next tick. */
export const SEO_TOOL_SEO_NEEDED_MS = 120_000;

function emptyProgress(analyse: AnalyseOutput, source: SeoToolAnalyseSource): SeoToolProgress {
  return { analyse, analyse_source: source, models: [], calls: 0, input_tokens: 0, output_tokens: 0, cost_eur: 0 };
}

function addCall(progress: SeoToolProgress, call: { model: string; usage: { inputTokens: number; outputTokens: number } }): SeoToolProgress {
  return {
    ...progress,
    models: progress.models.includes(call.model) ? progress.models : [...progress.models, call.model],
    calls: progress.calls + 1,
    input_tokens: progress.input_tokens + call.usage.inputTokens,
    output_tokens: progress.output_tokens + call.usage.outputTokens,
    cost_eur: roundEur(progress.cost_eur + estimateCostEur(call.model, call.usage)),
  };
}

/** The progress stored on a job row between two ticks, re-normalised; null without one. */
export function readSeoToolProgress(result: unknown, context: ContentPipelineContext): SeoToolProgress | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Partial<SeoToolProgress> & { html?: unknown };
  if (r.html != null || !r.analyse || typeof r.analyse !== "object") return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    analyse: normalizeAnalyse(r.analyse, context),
    analyse_source: r.analyse_source === "pasted" ? "pasted" : "model",
    models: Array.isArray(r.models) ? r.models.filter((m): m is string => typeof m === "string") : [],
    calls: n(r.calls),
    input_tokens: n(r.input_tokens),
    output_tokens: n(r.output_tokens),
    cost_eur: n(r.cost_eur),
  };
}

/** Normalised model answer → what the job stores. */
export function seoToolResult(
  output: TextOutput,
  progress: SeoToolProgress,
  model: string,
  payload: Pick<SeoToolPayload, "pageName" | "pageType" | "fileName">,
): SeoToolResult {
  return {
    blocks: output.blocks,
    title: output.title,
    meta_description: output.meta_description,
    html: renderBlocksHtml(output.blocks),
    analyse: progress.analyse,
    analyse_source: progress.analyse_source,
    model,
    models: [...progress.models],
    calls: progress.calls,
    input_tokens: progress.input_tokens,
    output_tokens: progress.output_tokens,
    cost_eur: progress.cost_eur,
    page_name: payload.pageName,
    page_type: payload.pageType,
    file_name: payload.fileName,
  };
}

/**
 * The two calls on a loaded context, pure apart from the callbacks: step 1 unless an
 * Analyse is already there (pasted, or stored by an earlier tick), then step 2 with it.
 * Throws `ContentLlmError` like a pipeline step; the Analyse saved before the error is what
 * the retry resumes from.
 */
export async function runSeoOnContext(
  context: ContentPipelineContext,
  payload: Pick<SeoToolPayload, "pageName" | "pageType" | "fileName">,
  options: SeoToolRunOptions = {},
): Promise<SeoToolRunOutcome> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const call = options.call ?? callContentTool;
  const models = options.models?.write ?? [];
  const record = options.recordUsage ?? (() => Promise.resolve());

  let progress = readSeoToolProgress(options.previous, context);
  if (!progress) {
    const pasted = pastedSeoToolAnalyse(context);
    if (pasted) {
      progress = emptyProgress(pasted, "pasted");
    } else {
      const spec = seoToolAnalyseSpec(context);
      const answer = await call({
        models,
        system: spec.system,
        user: spec.user,
        tool: spec.tool,
        maxTokens: spec.maxTokens,
        timeoutMs: Math.max(30_000, Math.min(ANALYSE_TIMEOUT_MS, deadline - now())),
      });
      await record({ model: answer.model, inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens });
      progress = addCall(emptyProgress(spec.normalize(answer.json, context) as AnalyseOutput, "model"), answer);
      await options.saveProgress?.(progress);
    }
  }

  const remaining = deadline - now();
  if (remaining < SEO_TOOL_SEO_NEEDED_MS) return { state: "partial", progress };

  const withAnalyse = withSeoToolAnalyse(context, progress.analyse);
  const spec = seoToolSpec(withAnalyse);
  const answer = await call({
    models,
    system: spec.system,
    user: spec.user,
    tool: spec.tool,
    maxTokens: spec.maxTokens,
    timeoutMs: remaining,
  });
  await record({ model: answer.model, inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens });
  progress = addCall(progress, answer);

  const output = spec.normalize(answer.json, withAnalyse) as TextOutput;
  if (output.blocks.length === 0) {
    throw new ContentLlmError("Das Modell hat keinen Seitentext geliefert. Bitte erneut versuchen.", true);
  }
  return { state: "done", result: seoToolResult(output, progress, answer.model, payload) };
}

/**
 * One tick of an SEO run: context, the Analyse (unless given), the SEO text, a usage event
 * per call. Throws `ContentLlmError` (with its retry hint) like a pipeline step.
 */
export async function runSeoTextTool(
  service: SupabaseClient,
  payload: SeoToolPayload,
  options: SeoToolRunOptions = {},
): Promise<SeoToolRunOutcome> {
  const { context, avatarId } = await loadSeoToolContext(service, payload);
  const models = options.models ?? (await loadContentModelConfig(service));
  return runSeoOnContext(context, payload, {
    ...options,
    models,
    recordUsage:
      options.recordUsage ??
      ((usage) =>
        recordLlmUsageEvent(service, {
          organisationId: payload.organisationId,
          userId: payload.userId,
          agentId: avatarId,
          mode: SEO_TOOL_USAGE_MODE,
          via: "direct",
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        })),
  });
}

/** `jobs` row → the three states the SEO page polls for, with the progress line while it runs. */
export function seoToolJobFromRow(row: { status: string; result: unknown; last_error: string | null }): SeoToolJob {
  if (row.status === "succeeded") {
    const result = (row.result as SeoToolResult | null) ?? null;
    if (!result?.html) return { state: "error", progress: null, result: null, error: "Der Durchlauf hat kein Ergebnis hinterlassen." };
    return { state: "done", progress: null, result, error: null };
  }
  if (row.status === "dead") {
    return { state: "error", progress: null, result: null, error: row.last_error ?? "Die Verarbeitung ist fehlgeschlagen." };
  }
  const stored = row.result && typeof row.result === "object" && !Array.isArray(row.result) ? (row.result as { analyse?: unknown }) : null;
  const progress = stored?.analyse ? "Analyse fertig, der Seitentext wird geschrieben." : null;
  return { state: "running", progress, result: null, error: null };
}

/** „Hauptsilo-Seite“ … for the dropdown and the result line. */
export const SEO_TOOL_PAGE_TYPE_OPTIONS: ReadonlyArray<{ value: SeoToolPageType; label: string }> = SEO_TOOL_PAGE_TYPES.map((value) => ({
  value,
  label: CONTENT_PAGE_TYPE_LABELS[value],
}));
