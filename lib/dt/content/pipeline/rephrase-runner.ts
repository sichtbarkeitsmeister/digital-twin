/**
 * The one implementation of the Grok rewrite that the step „Watermark Entfernung“ of Texte
 * and the standalone Watermark tool under Verwaltung share. Takes blocks and a prompt
 * context, works through the chunks `rephrase.ts` plans, one short Grok call each, and hands
 * the progress to the caller after every chunk, so each caller stores it where it belongs
 * (the step row, the job row). With little budget left the run pauses and reports
 * `partial`; the next tick resumes with the chunks still open.
 *
 * xAI only: `callXaiText` has no fallback to Claude, and neither has this runner.
 */

import { rephraseChunkPrompt, type RephrasePromptContext } from "@/lib/dt/content/pipeline/prompts";
import {
  REPHRASE_CHUNK_TIMEOUT_MS,
  REPHRASE_MIN_REMAINING_MS,
  REPHRASE_SLOW_MODEL_MS,
  parseRephrasedChunk,
  planRephraseChunks,
  rephraseChunkMaxTokens,
  rephraseModelOrder,
  rephrasedBlocks,
  type RephraseProgress,
} from "@/lib/dt/content/pipeline/rephrase";
import { XaiTimeoutError, callXaiText, resolveXaiModels, type XaiTextCall, type XaiTextResult } from "@/lib/dt/content/pipeline/xai";
import { estimateCostEur, roundEur } from "@/lib/dt/content/pricing";
import type { ContentTextBlock } from "@/lib/dt/content/render";

export type RephraseUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Estimated cost of this one call, already rounded into `progress.cost_eur`. */
  costEur: number;
};

/** Why the runner hands the progress over: after an answered chunk, or because the run pauses. */
export type RephraseSaveReason = "chunk" | "paused";

export type RephraseRunOptions = {
  /** The progress so far (`readRephraseProgress`); updated in place while the run goes on. */
  progress: RephraseProgress;
  /** Epoch ms: no new call starts when less than `REPHRASE_MIN_REMAINING_MS` is left before it. */
  deadline: number;
  /** Every answered chunk, for the usage events of the caller. */
  onUsage: (usage: RephraseUsage) => Promise<void>;
  /**
   * Stores the progress: after each chunk (`chunk`), and before the run hands back `partial`
   * or rethrows a slow model's timeout (`paused`, with the model noted in `slow_models`).
   */
  save: (progress: RephraseProgress, info: { reason: RephraseSaveReason; model: string }) => Promise<void>;
  /** After a chunk: is the result still wanted? A page that was stopped or reset says no. */
  stillWanted?: () => Promise<boolean>;
  /** Candidate models in order; defaults to `resolveXaiModels()`. */
  models?: readonly string[];
  /** Tests pass a stub; production calls Grok. */
  call?: (input: XaiTextCall) => Promise<XaiTextResult>;
  now?: () => number;
};

export type RephraseRunResult =
  /** Out of budget between two chunks; the progress is saved, the next tick continues. */
  | { state: "partial"; model: string }
  /** Nobody wants the result any more (page stopped or reset); nothing more was saved. */
  | { state: "discarded"; model: string }
  | { state: "done"; model: string; blocks: ContentTextBlock[] };

/**
 * Rewrites `blocks` in chunks on Grok. Throws the `ContentLlmError` of the failing call
 * (German message, retry hint) after the progress is saved, so the caller's retry pays
 * only for the chunks still open.
 */
export async function runRephraseOnBlocks(
  context: RephrasePromptContext,
  blocks: readonly ContentTextBlock[],
  options: RephraseRunOptions,
): Promise<RephraseRunResult> {
  const { progress } = options;
  const now = options.now ?? Date.now;
  const candidates = options.models && options.models.length > 0 ? options.models : resolveXaiModels();
  const call = options.call ?? callXaiText;
  let model = progress.models[progress.models.length - 1] ?? candidates[0]!;

  for (const chunk of planRephraseChunks(blocks, progress.rewritten)) {
    const remaining = options.deadline - now();
    if (remaining < REPHRASE_MIN_REMAINING_MS) {
      await options.save(progress, { reason: "paused", model });
      return { state: "partial", model };
    }

    const prompt = rephraseChunkPrompt(context, chunk);
    let answer: XaiTextResult;
    try {
      answer = await call({
        system: prompt.system,
        user: prompt.user,
        maxTokens: rephraseChunkMaxTokens(chunk),
        timeoutMs: Math.min(remaining, REPHRASE_CHUNK_TIMEOUT_MS),
        models: rephraseModelOrder(candidates, progress.slow_models),
      });
    } catch (error) {
      // A model that needs more than a minute for one small chunk is the wrong model for this
      // text: remember it, so the retry starts with the next candidate instead of failing again.
      if (error instanceof XaiTimeoutError && error.elapsedMs >= REPHRASE_SLOW_MODEL_MS && !progress.slow_models.includes(error.model)) {
        progress.slow_models.push(error.model);
        await options.save(progress, { reason: "paused", model }).catch(() => undefined);
      }
      throw error;
    }

    model = answer.model;
    const costEur = estimateCostEur(answer.model, answer.usage);
    await options.onUsage({ model: answer.model, inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens, costEur });
    for (const block of parseRephrasedChunk(answer.text, chunk)) progress.rewritten[block.id] = block.html;
    progress.calls += 1;
    progress.input_tokens += answer.usage.inputTokens;
    progress.output_tokens += answer.usage.outputTokens;
    progress.cost_eur = roundEur(progress.cost_eur + costEur);
    if (!progress.models.includes(model)) progress.models.push(model);

    if (options.stillWanted && !(await options.stillWanted())) {
      return { state: "discarded", model };
    }
    await options.save(progress, { reason: "chunk", model });
  }

  return { state: "done", model, blocks: rephrasedBlocks(blocks, progress.rewritten) };
}
