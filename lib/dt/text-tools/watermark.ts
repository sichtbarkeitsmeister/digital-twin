/**
 * The standalone Watermark tool (Verwaltung → Watermark Entfernung): the Watermark step of the Texte
 * pipeline on an uploaded text. It belongs to no organisation and needs nothing but the
 * Grok key: no Texte settings, no page row, no background job, no database.
 *
 * The browser drives the run. `prepareWatermarkDocument` turns the upload into sections and
 * plans the Grok calls exactly like the Watermark step (`planRephraseChunks`); the browser then sends
 * one chunk at a time to the chunk route, which rewrites it with `rephraseWatermarkChunk`
 * through the runner the Watermark step uses (`runRephraseOnBlocks`, same prompt, same model order, same
 * parsing). The finished text is assembled and downloaded in the browser
 * (`watermark-export.ts`).
 *
 * Grok (xAI) only, like the Watermark step: without `XAI_API_KEY` the routes answer with the German
 * message, never with Claude.
 */

import { z } from "zod";

import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import { emptyRephraseProgress, planRephraseChunks, rephraseBlockCount } from "@/lib/dt/content/pipeline/rephrase";
import { runRephraseOnBlocks, type RephraseRunOptions, type RephraseUsage } from "@/lib/dt/content/pipeline/rephrase-runner";
import type { ContentTextBlock } from "@/lib/dt/content/render";
import type { IngestedText, UploadedDocument } from "@/lib/dt/text-tools/ingest";

/** Tag of the usage log lines (the run has no organisation, so it is not a usage event row). */
export const WATERMARK_TOOL_USAGE_MODE = "text-tool.watermark";
/** A planned chunk never has more blocks than this (`planRephraseChunks` uses four). */
export const WATERMARK_CHUNK_MAX_BLOCKS = 4;
/** Generous cap on the HTML of one chunk request; a planned chunk is far below it. */
export const WATERMARK_CHUNK_MAX_HTML_CHARS = 24_000;
/** Time one chunk request may use; the chunk route allows 300 s. */
export const WATERMARK_CHUNK_BUDGET_MS = 280_000;

/** What the parse route hands the browser: the sections and the plan of Grok calls. */
export type WatermarkDocument = {
  fileName: string;
  format: UploadedDocument["format"];
  /** `<title>` of an HTML upload, otherwise null. */
  title: string | null;
  chars: number;
  blocks: ContentTextBlock[];
  /** Block ids of each Grok call, in order, planned like the Watermark step. */
  chunks: string[][];
  /** How many blocks get rewritten (headings-only and one-liners stay as they are). */
  total: number;
};

export function prepareWatermarkDocument(
  fileName: string,
  format: UploadedDocument["format"],
  ingested: Pick<IngestedText, "blocks" | "title" | "chars">,
): WatermarkDocument {
  const chunks = planRephraseChunks(ingested.blocks).map((chunk) => chunk.map((block) => block.id));
  return {
    fileName,
    format,
    title: ingested.title,
    chars: ingested.chars,
    blocks: ingested.blocks,
    chunks,
    total: rephraseBlockCount(ingested.blocks),
  };
}

const blockSchema = z.object({
  id: z.string().min(1).max(60),
  heading: z.string().max(400).nullable(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  html: z.string(),
});

/** Body of one chunk request. */
export const watermarkChunkRequestSchema = z
  .object({
    blocks: z.array(blockSchema).min(1).max(WATERMARK_CHUNK_MAX_BLOCKS),
    /** Models that ran into the time limit on an earlier chunk of this run; they go last. */
    slowModels: z.array(z.string().min(1).max(80)).max(10).default([]),
  })
  .refine((body) => body.blocks.reduce((sum, b) => sum + b.html.length + (b.heading?.length ?? 0), 0) <= WATERMARK_CHUNK_MAX_HTML_CHARS, {
    message: "Abschnittsgruppe zu groß.",
  });

export type WatermarkChunkRequest = z.infer<typeof watermarkChunkRequestSchema>;

export type WatermarkChunkResponse = {
  /** The chunk's blocks with their new body HTML; ids, headings and levels unchanged. */
  blocks: ContentTextBlock[];
  model: string;
  /** The run's slow models after this call, for the next request. */
  slowModels: string[];
};

export type WatermarkChunkFailure = {
  message: string;
  /** Worth another try (rate limit, overload, timeout); false for a missing key or a refusal. */
  retryable: boolean;
  slowModels: string[];
};

export type WatermarkChunkOptions = {
  slowModels?: readonly string[];
  /** Epoch ms; defaults to now + `WATERMARK_CHUNK_BUDGET_MS`. */
  deadline?: number;
  onUsage?: (usage: RephraseUsage) => Promise<void>;
  models?: RephraseRunOptions["models"];
  call?: RephraseRunOptions["call"];
  now?: RephraseRunOptions["now"];
};

/**
 * One chunk of a Watermark run on Grok, through the runner the Watermark step uses. Never throws a model
 * error: the German message, the retry hint and the slow models come back as a failure, so
 * the route can hand all three to the browser.
 */
export async function rephraseWatermarkChunk(
  blocks: readonly ContentTextBlock[],
  options: WatermarkChunkOptions = {},
): Promise<{ ok: true; value: WatermarkChunkResponse } | { ok: false; error: WatermarkChunkFailure }> {
  const now = options.now ?? Date.now;
  const progress = emptyRephraseProgress(rephraseBlockCount(blocks));
  progress.slow_models = Array.from(new Set(options.slowModels ?? []));
  try {
    const run = await runRephraseOnBlocks({ notes: [] }, blocks, {
      progress,
      deadline: options.deadline ?? now() + WATERMARK_CHUNK_BUDGET_MS,
      onUsage: options.onUsage ?? (async () => undefined),
      // Nothing to store between calls: the browser holds the run.
      save: async () => undefined,
      models: options.models,
      call: options.call,
      now,
    });
    if (run.state !== "done") {
      return {
        ok: false,
        error: { message: "Für diese Abschnittsgruppe reichte die Zeit nicht. Sie wird erneut versucht.", retryable: true, slowModels: progress.slow_models },
      };
    }
    return { ok: true, value: { blocks: run.blocks, model: run.model, slowModels: progress.slow_models } };
  } catch (error) {
    if (error instanceof ContentLlmError) {
      return { ok: false, error: { message: error.message, retryable: error.retryable, slowModels: progress.slow_models } };
    }
    console.error("[text-tool.watermark] chunk failed", error);
    return {
      ok: false,
      error: { message: "Die Abschnittsgruppe konnte nicht verarbeitet werden.", retryable: true, slowModels: progress.slow_models },
    };
  }
}
