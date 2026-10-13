/**
 * The standalone GEO tool (Verwaltung → GEO): one run of the pipeline's step 4 on an
 * uploaded text, without a page row. Prompt, tool schema, model tier and output handling
 * are the pipeline's (`lib/dt/content/pipeline/prompts.ts`); only the context differs: a
 * document instead of a page with Excel briefing, optional questions instead of the
 * Analyse, an optional pasted Faktencheck instead of step 3.
 *
 * `geoTextToolSpec` and the payload/result shapes are pure; `runGeoTextTool` loads the
 * organisation's Texte context and calls Claude (injectable for tests).
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
import { ContentLlmError, callContentTool } from "@/lib/dt/content/pipeline/llm";
import {
  GEO_MAX_TOKENS,
  GEO_TOOL,
  anbieterBlock,
  avatarBlock,
  currentTextBlock,
  editorNotesBlock,
  geoSystemPrompt,
  joinPromptParts,
  normalizeGeoOutput,
  settingsBlock,
  type ContentStepSpec,
  type TextOutput,
} from "@/lib/dt/content/pipeline/prompts";
import { estimateCostEur, roundEur } from "@/lib/dt/content/pricing";
import { renderBlocksHtml, type ContentTextBlock } from "@/lib/dt/content/render";
import { loadContentSettings, settingsFromRow } from "@/lib/dt/content/store";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";

/** `jobs.kind` of a run and the `mode` of its usage events. */
export const GEO_TOOL_JOB_KIND = "text-tool.geo";
export const GEO_TOOL_USAGE_MODE = "text-tool.geo";
export const GEO_TOOL_MAX_NOTES_CHARS = 4_000;
export const GEO_TOOL_MAX_QUESTIONS_CHARS = 4_000;
export const GEO_TOOL_MAX_FAKTENCHECK_CHARS = 20_000;

const blockSchema = z.object({
  id: z.string().min(1).max(60),
  heading: z.string().nullable(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  html: z.string(),
});

/** What the run route stores on the job; the handler reads it back. */
export const geoToolPayloadSchema = z.object({
  organisationId: z.string().uuid(),
  userId: z.string().uuid(),
  fileName: z.string().min(1).max(260),
  /** Label only (the „Seite“ line of the prompt); never a database key. */
  pageName: z.string().max(200).nullable(),
  blocks: z.array(blockSchema).min(1).max(40),
  title: z.string().max(200).nullable(),
  metaDescription: z.string().max(400).nullable(),
  /** Redaktionelle Anmerkungen; one note per paragraph. */
  notes: z.array(z.string().max(GEO_TOOL_MAX_NOTES_CHARS)).max(20),
  /** Main question and fan-out questions, one per line; empty when the person gave none. */
  questions: z.array(z.string().max(600)).max(40),
  /** A pasted Faktencheck result (step 3 JSON); null when none was given. */
  faktencheck: z.unknown().nullable(),
});

export type GeoToolPayload = z.infer<typeof geoToolPayloadSchema>;

export type GeoToolResult = {
  blocks: ContentTextBlock[];
  title: string | null;
  meta_description: string | null;
  /** The blocks rendered as the stored page HTML (`<section data-block-id>`), for preview and export. */
  html: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_eur: number;
  file_name: string;
  page_name: string | null;
  /** Number of blocks the upload had, for the UI („12 Abschnitte“). */
  input_blocks: number;
};

/** What the status route hands the browser. */
export type GeoToolJob = {
  state: "running" | "done" | "error";
  result: GeoToolResult | null;
  error: string | null;
};

export type GeoToolStartResult = {
  id: string;
  status_url: string;
  /** What was read from the upload, so the UI can show it while the model works. */
  input: { blocks: number; chars: number; title: string | null; format: string };
};

export type GeoToolContext = {
  organisationName: string;
  fileName: string;
  pageName: string | null;
  sections: WorkshopAnbieterSection[];
  settings: ContentTextSettings;
  avatar: { name: string; role: string; beschreibung: string } | null;
  notes: string[];
  questions: string[];
  faktencheck: unknown | null;
  blocks: ContentTextBlock[];
  title: string | null;
  metaDescription: string | null;
};

const MAX_JSON_CHARS = 12_000;

/** Replaces the pipeline's „Seite“ block: what the text is and where it came from. */
function documentBlock(context: GeoToolContext): string {
  return [
    "## Seite",
    `Organisation: ${context.organisationName || "unbekannt"}`,
    context.pageName ? `Seite: ${context.pageName}` : "",
    `Quelle: hochgeladene Datei „${context.fileName}“ (eigenständiges GEO-Werkzeug, kein Seiten-Briefing, kein Faktencheck-Schritt vorab)`,
    "Erlaubte interne Linkziele: keine bekannt – keine neuen internen Links setzen, vorhandene [LINK: …]-Marker bleiben",
    context.questions.length === 0
      ? "Es liegt keine Analyse mit Fragen vor: der Text wird nur nach den GEO-Regeln umgebaut, keine neuen Fragen hinzuerfinden."
      : "",
    context.faktencheck == null
      ? "Es liegt kein Faktencheck vor: Angaben, die nicht in den Anbieterfakten oder Anmerkungen stehen, nur als [BITTE PRÜFEN: …] markieren, nicht streichen."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The person's questions in the shape of the Analyse output, so the GEO rules
 * („fanout_questions aus der Analyse …“) apply to them unchanged. The first line is the
 * main question, the rest are fan-out questions.
 */
function questionsBlock(questions: readonly string[]): string {
  if (questions.length === 0) return "";
  const [main, ...rest] = questions;
  const analyse = {
    main_question: main,
    fanout_questions: rest.map((question) => ({ question, source: "Redaktion", theme: "" })),
    deferred_questions: [],
  };
  return `## Analyse (Schritt 1) – Fragen, die der Text abdecken muss\n${JSON.stringify(analyse, null, 1).slice(0, MAX_JSON_CHARS)}`;
}

function faktencheckBlock(faktencheck: unknown): string {
  if (faktencheck == null) return "";
  return `## Faktencheck (Schritt 3) – umsetzen\n${JSON.stringify(faktencheck, null, 1).slice(0, MAX_JSON_CHARS)}`;
}

/** Step 4 of the pipeline for an uploaded document: same system prompt, same tool, same normalisation. */
export function geoTextToolSpec(context: GeoToolContext): ContentStepSpec {
  return {
    maxTokens: GEO_MAX_TOKENS,
    system: geoSystemPrompt(context.settings),
    user: joinPromptParts([
      documentBlock(context),
      currentTextBlock(context),
      questionsBlock(context.questions),
      faktencheckBlock(context.faktencheck),
      anbieterBlock(context),
      settingsBlock(context.settings),
      avatarBlock(context),
      editorNotesBlock(context.notes),
    ]),
    tool: GEO_TOOL,
    normalize: (json) => normalizeGeoOutput(json, context),
  };
}

/** Textarea → notes: paragraphs separated by a blank line, at most 20. */
export function splitNotes(text: string | null | undefined): string[] {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((n) => n.trim().slice(0, GEO_TOOL_MAX_NOTES_CHARS))
    .filter(Boolean)
    .slice(0, 20);
}

/** Textarea → questions: one per line, leading bullets and numbers dropped, at most 40. */
export function splitQuestions(text: string | null | undefined): string[] {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((q) => q.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, "").trim().slice(0, 600))
    .filter(Boolean)
    .slice(0, 40);
}

/** Pasted Faktencheck JSON → object; a message when it is not JSON. Empty input is „none“. */
export function parseFaktencheckJson(text: string | null | undefined): { ok: true; value: unknown | null } | { ok: false; message: string } {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > GEO_TOOL_MAX_FAKTENCHECK_CHARS) {
    return { ok: false, message: `Das Faktencheck-JSON ist zu lang (max. ${GEO_TOOL_MAX_FAKTENCHECK_CHARS.toLocaleString("de-DE")} Zeichen).` };
  }
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!value || typeof value !== "object") return { ok: false, message: "Das Faktencheck-JSON muss ein Objekt mit „findings“ und „questions“ sein." };
    return { ok: true, value };
  } catch {
    return { ok: false, message: "Das Faktencheck-Feld enthält kein gültiges JSON." };
  }
}

export type GeoToolModelCall = (input: {
  models: string[];
  system: string;
  user: string;
  tool: ContentStepSpec["tool"];
  maxTokens: number;
  timeoutMs?: number;
}) => Promise<{ json: unknown; usage: { inputTokens: number; outputTokens: number }; model: string }>;

/**
 * Loads what the Texte pipeline loads for a page (confirmed settings, Anbieterfakten, the
 * configured or newest avatar) and builds the context around the uploaded blocks.
 * Settings are required like in the pipeline; Anbieterfakten may be empty here, the text
 * already exists and the rules then only mark unproven claims.
 */
export async function loadGeoToolContext(service: SupabaseClient, payload: GeoToolPayload): Promise<{ context: GeoToolContext; avatarId: string | null }> {
  const [{ data: organisation }, settingsRow, anbieter] = await Promise.all([
    service.from("organisations").select("name").eq("id", payload.organisationId).maybeSingle(),
    loadContentSettings(service, payload.organisationId),
    loadContentAnbieterSources(service, payload.organisationId),
  ]);
  if (!settingsRow) {
    throw new ContentLlmError("Die Einstellungen für Texte sind für diese Organisation noch nicht bestätigt. Bitte zuerst unter Texte bestätigen.", false);
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
    context: {
      organisationName: (organisation?.name as string | undefined)?.trim() || "",
      fileName: payload.fileName,
      pageName: payload.pageName,
      sections: anbieter.sections,
      settings: settingsFromRow(settingsRow),
      avatar: avatar ? { name: avatar.name, role: avatar.role, beschreibung: avatar.beschreibung } : null,
      notes: payload.notes,
      questions: payload.questions,
      faktencheck: payload.faktencheck ?? null,
      blocks: payload.blocks,
      title: payload.title,
      metaDescription: payload.metaDescription,
    },
  };
}

/** Normalised model answer → what the job stores. */
export function geoToolResult(
  output: TextOutput,
  call: { model: string; usage: { inputTokens: number; outputTokens: number } },
  payload: Pick<GeoToolPayload, "fileName" | "pageName" | "blocks">,
): GeoToolResult {
  return {
    blocks: output.blocks,
    title: output.title,
    meta_description: output.meta_description,
    html: renderBlocksHtml(output.blocks),
    model: call.model,
    input_tokens: call.usage.inputTokens,
    output_tokens: call.usage.outputTokens,
    cost_eur: roundEur(estimateCostEur(call.model, call.usage)),
    file_name: payload.fileName,
    page_name: payload.pageName,
    input_blocks: payload.blocks.length,
  };
}

/**
 * One GEO run: context, one tool call on the write tier of the Texte models, usage event,
 * result. Throws `ContentLlmError` (with its retry hint) like a pipeline step.
 */
export async function runGeoTextTool(
  service: SupabaseClient,
  payload: GeoToolPayload,
  options: { timeoutMs?: number; call?: GeoToolModelCall } = {},
): Promise<GeoToolResult> {
  const { context, avatarId } = await loadGeoToolContext(service, payload);
  const models = await loadContentModelConfig(service);
  const spec = geoTextToolSpec(context);
  const call = options.call ?? callContentTool;
  const answer = await call({
    models: models.write,
    system: spec.system,
    user: spec.user,
    tool: spec.tool,
    maxTokens: spec.maxTokens,
    timeoutMs: options.timeoutMs,
  });

  await recordLlmUsageEvent(service, {
    organisationId: payload.organisationId,
    userId: payload.userId,
    agentId: avatarId,
    mode: GEO_TOOL_USAGE_MODE,
    via: "direct",
    model: answer.model,
    inputTokens: answer.usage.inputTokens,
    outputTokens: answer.usage.outputTokens,
  });

  return geoToolResult(normalizeGeoOutput(answer.json, context), answer, payload);
}

/** `jobs` row → the three states the GEO page polls for. */
export function geoToolJobFromRow(row: { status: string; result: unknown; last_error: string | null }): GeoToolJob {
  const result = (row.result as GeoToolResult | null) ?? null;
  if (row.status === "succeeded") return { state: "done", result, error: null };
  if (row.status === "dead") {
    return { state: "error", result: null, error: row.last_error ?? "Die Verarbeitung ist fehlgeschlagen." };
  }
  return { state: "running", result: null, error: null };
}
