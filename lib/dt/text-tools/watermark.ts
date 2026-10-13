/**
 * The standalone Watermark tool (Verwaltung → Watermark Entfernung): step 8 of the Texte
 * pipeline once on an uploaded text, without a page row. Prompt, chunking, model order and
 * progress are the pipeline's (`rephrase.ts`, `rephrase-runner.ts`, `rephraseChunkPrompt`);
 * only the context differs: the confirmed Texte settings and the person's notes, no page.
 *
 * The run is a background job (`text-tool.watermark`). Between two ticks the progress lives
 * on the job row (`result.progress`), so a tick that runs out of budget hands the job back
 * half done and the next tick continues with the chunks still open. Grok (xAI) only, like
 * step 8: without `XAI_API_KEY` the run fails with the German message, never on Claude.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { ContentTextSettings } from "@/lib/dt/content/mapping";
import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import type { RephrasePromptContext } from "@/lib/dt/content/pipeline/prompts";
import {
  readRephraseProgress,
  rephraseBlockCount,
  rephraseProgressLabel,
  type RephraseProgress,
} from "@/lib/dt/content/pipeline/rephrase";
import { runRephraseOnBlocks, type RephraseRunOptions } from "@/lib/dt/content/pipeline/rephrase-runner";
import { renderBlocksHtml, type ContentTextBlock } from "@/lib/dt/content/render";
import { loadContentSettings, settingsFromRow } from "@/lib/dt/content/store";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import { TEXT_TOOL_MAX_BLOCKS } from "@/lib/dt/text-tools/ingest";

/** `jobs.kind` of a run and the `mode` of its usage events. */
export const WATERMARK_TOOL_JOB_KIND = "text-tool.watermark";
export const WATERMARK_TOOL_USAGE_MODE = "text-tool.watermark";
export const WATERMARK_TOOL_MAX_NOTES_CHARS = 4_000;
export const WATERMARK_TOOL_MAX_NOTES = 20;

const blockSchema = z.object({
  id: z.string().min(1).max(60),
  heading: z.string().nullable(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  html: z.string(),
});

/** What the run route stores on the job; the handler reads it back on every tick. */
export const watermarkToolPayloadSchema = z.object({
  organisationId: z.string().uuid(),
  userId: z.string().uuid(),
  fileName: z.string().min(1).max(260),
  /** Label only (the export's file name); never a database key. */
  pageName: z.string().max(200).nullable(),
  blocks: z.array(blockSchema).min(1).max(TEXT_TOOL_MAX_BLOCKS),
  title: z.string().max(200).nullable(),
  metaDescription: z.string().max(400).nullable(),
  /** Redaktionelle Anmerkungen; one note per paragraph. */
  notes: z.array(z.string().max(WATERMARK_TOOL_MAX_NOTES_CHARS)).max(WATERMARK_TOOL_MAX_NOTES),
});

export type WatermarkToolPayload = z.infer<typeof watermarkToolPayloadSchema>;

export type WatermarkToolResult = {
  blocks: ContentTextBlock[];
  title: string | null;
  meta_description: string | null;
  /** The blocks rendered as the stored page HTML (`<section data-block-id>`), for preview and export. */
  html: string;
  /** The model of the last chunk; `models` lists every model that answered. */
  model: string;
  models: string[];
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_eur: number;
  file_name: string;
  page_name: string | null;
  /** Number of blocks the upload had, for the UI („12 Abschnitte“). */
  input_blocks: number;
  /** How many of them were rewritten (the H1 and one-liners stay as they are). */
  rewritten_blocks: number;
};

/** What the job row's `result` holds while the run is not finished. */
export type WatermarkToolJobState = { progress: RephraseProgress };

/** What the status route hands the browser. */
export type WatermarkToolJob = {
  state: "running" | "done" | "error";
  /** „4 von 11 Abschnitten“ while it runs; null before the first chunk. */
  progress: string | null;
  result: WatermarkToolResult | null;
  error: string | null;
};

export type WatermarkToolStartResult = {
  id: string;
  status_url: string;
  /** What was read from the upload, so the UI can show it while the model works. */
  input: { blocks: number; rewrite: number; chars: number; title: string | null; format: string };
};

export type WatermarkToolContext = RephrasePromptContext & {
  settings: ContentTextSettings;
  notes: string[];
  fileName: string;
  pageName: string | null;
  blocks: ContentTextBlock[];
  title: string | null;
  metaDescription: string | null;
};

/** Textarea → notes: paragraphs separated by a blank line, at most 20. */
export function splitWatermarkNotes(text: string | null | undefined): string[] {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((n) => n.trim().slice(0, WATERMARK_TOOL_MAX_NOTES_CHARS))
    .filter(Boolean)
    .slice(0, WATERMARK_TOOL_MAX_NOTES);
}

/**
 * Loads what step 8 reads for a page: the confirmed Texte settings (required, like in the
 * pipeline). Anbieterfakten and avatar are not part of the step-8 prompt, so they are not
 * loaded here either.
 */
export async function loadWatermarkToolContext(service: SupabaseClient, payload: WatermarkToolPayload): Promise<WatermarkToolContext> {
  const settingsRow = await loadContentSettings(service, payload.organisationId);
  if (!settingsRow) {
    throw new ContentLlmError("Die Einstellungen für Texte sind für diese Organisation noch nicht bestätigt. Bitte zuerst unter Texte bestätigen.", false);
  }
  return {
    settings: settingsFromRow(settingsRow),
    notes: payload.notes,
    fileName: payload.fileName,
    pageName: payload.pageName,
    blocks: payload.blocks,
    title: payload.title,
    metaDescription: payload.metaDescription,
  };
}

/** The progress stored on a job row between two ticks, or a fresh one for these blocks. */
export function readWatermarkJobProgress(result: unknown, blocks: readonly ContentTextBlock[]): RephraseProgress {
  const stored = result && typeof result === "object" && !Array.isArray(result) ? (result as { progress?: unknown }).progress : undefined;
  return readRephraseProgress(stored, rephraseBlockCount(blocks));
}

/** Finished run → what the job stores and the page shows. */
export function watermarkToolResult(
  blocks: readonly ContentTextBlock[],
  progress: RephraseProgress,
  model: string,
  payload: Pick<WatermarkToolPayload, "fileName" | "pageName" | "blocks" | "title" | "metaDescription">,
): WatermarkToolResult {
  return {
    blocks: [...blocks],
    title: payload.title,
    meta_description: payload.metaDescription,
    html: renderBlocksHtml(blocks),
    model,
    models: [...progress.models],
    calls: progress.calls,
    input_tokens: progress.input_tokens,
    output_tokens: progress.output_tokens,
    cost_eur: progress.cost_eur,
    file_name: payload.fileName,
    page_name: payload.pageName,
    input_blocks: payload.blocks.length,
    rewritten_blocks: Object.keys(progress.rewritten).length,
  };
}

export type WatermarkToolRunOutcome =
  /** Out of budget between two chunks; `progress` is what the handler stores and reschedules with. */
  | { state: "partial"; progress: RephraseProgress }
  | { state: "done"; result: WatermarkToolResult };

export type WatermarkToolRunOptions = {
  timeoutMs?: number;
  /** The job row's `result` from the previous tick (or null on the first). */
  previous?: unknown;
  /** Stores the progress after every chunk and on a pause, so a dying worker loses at most one call. */
  saveProgress?: (state: WatermarkToolJobState) => Promise<void>;
  /** Usage of one answered chunk; production records a usage event. */
  recordUsage?: (usage: { model: string; inputTokens: number; outputTokens: number }) => Promise<void>;
  models?: RephraseRunOptions["models"];
  call?: RephraseRunOptions["call"];
  now?: RephraseRunOptions["now"];
};

const DEFAULT_TIMEOUT_MS = 240_000;

/**
 * The chunked rewrite on a loaded context, pure apart from the callbacks: the same runner
 * as step 8, with the job row instead of the step row as the place for the progress.
 */
export async function runWatermarkOnContext(
  context: WatermarkToolContext,
  payload: WatermarkToolPayload,
  options: WatermarkToolRunOptions = {},
): Promise<WatermarkToolRunOutcome> {
  const now = options.now ?? Date.now;
  const progress = readWatermarkJobProgress(options.previous, context.blocks);
  const run = await runRephraseOnBlocks(context, context.blocks, {
    progress,
    deadline: now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    onUsage: (usage) => options.recordUsage?.(usage) ?? Promise.resolve(),
    // After a chunk and on a pause alike (the pause may carry a newly noted slow model).
    save: (state) => options.saveProgress?.({ progress: state }) ?? Promise.resolve(),
    models: options.models,
    call: options.call,
    now,
  });
  if (run.state === "done") {
    return { state: "done", result: watermarkToolResult(run.blocks, progress, run.model, payload) };
  }
  // `discarded` cannot happen here (no stop button); treat it like a pause to be safe.
  return { state: "partial", progress };
}

/**
 * One tick of a Watermark run: context, as many chunks as the budget allows, a usage event
 * per call. Throws `ContentLlmError` (with its retry hint) like a pipeline step; the
 * progress saved before the error is what the retry resumes from.
 */
export async function runWatermarkTextTool(
  service: SupabaseClient,
  payload: WatermarkToolPayload,
  options: WatermarkToolRunOptions = {},
): Promise<WatermarkToolRunOutcome> {
  const context = await loadWatermarkToolContext(service, payload);
  return runWatermarkOnContext(context, payload, {
    ...options,
    recordUsage:
      options.recordUsage ??
      ((usage) =>
        recordLlmUsageEvent(service, {
          organisationId: payload.organisationId,
          userId: payload.userId,
          agentId: null,
          mode: WATERMARK_TOOL_USAGE_MODE,
          via: "direct",
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        })),
  });
}

/** `jobs` row → the three states the page polls for, with the progress line while it runs. */
export function watermarkToolJobFromRow(row: { status: string; result: unknown; last_error: string | null }): WatermarkToolJob {
  if (row.status === "succeeded") {
    const result = (row.result as WatermarkToolResult | null) ?? null;
    if (!result?.html) return { state: "error", progress: null, result: null, error: "Der Durchlauf hat kein Ergebnis hinterlassen." };
    return { state: "done", progress: null, result, error: null };
  }
  if (row.status === "dead") {
    return { state: "error", progress: null, result: null, error: row.last_error ?? "Die Verarbeitung ist fehlgeschlagen." };
  }
  const stored = row.result && typeof row.result === "object" && !Array.isArray(row.result) ? (row.result as { progress?: unknown }).progress : undefined;
  return { state: "running", progress: rephraseProgressLabel(stored), result: null, error: null };
}
