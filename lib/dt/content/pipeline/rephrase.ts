/**
 * The step „Watermark Entfernung“ on Grok, the pure parts. The page is rewritten in small
 * groups of sections, one short Grok call each, and the progress is saved on the step row
 * after every group. A job tick that runs out of time hands the step back half done; the
 * next tick continues where it stopped. `run-step.ts` drives the calls, `prompts.ts` builds
 * the prompt text, this module plans the chunks, reads the answers and keeps the progress.
 *
 * The model prompt describes a plain language pass; the step's UI name stays out of it on
 * purpose, since the model refuses some framings. Facts, headings, ids and markers are not
 * the model's to change: headings, ids and levels always come from the previous text.
 */

import { stripCodeFences } from "@/lib/ai/anthropic-helpers";
import { parseBlocksFromHtml, renderBlocksHtml, sanitizeBlockHtml, type ContentTextBlock } from "@/lib/dt/content/render";

/** Characters of plain text per Grok call: short enough to answer in well under a minute. */
export const REPHRASE_CHUNK_CHARS = 1_800;
/** One Grok call may take this long; the job budget caps it further. */
export const REPHRASE_CHUNK_TIMEOUT_MS = 120_000;
/** Below this much remaining budget the step saves its progress and waits for the next tick. */
export const REPHRASE_MIN_REMAINING_MS = 45_000;
/** Blocks with less text than this (the H1, „Zuletzt aktualisiert“) are not worth a call. */
const MIN_TEXT_CHARS = 40;
const MAX_CHUNK_BLOCKS = 4;

export const REPHRASE_SYSTEM = `Du überarbeitest den fertigen Seitentext sprachlich.
Schreibe jeden Satz neu. Kopiere keinen Satz wörtlich.
Behalte unverändert: HTML-Blöcke und ids, H1, alle Überschriften (auch Fragen-Überschriften), alle Fakten, Namen, Zahlen, [LINK: …], [BITTE PRÜFEN: …], [DATUM], Handlungsaufforderungen (Termin, Telefon, DrFlex).
Natürliches Deutsch: Satzlängen mischen, keine Werbe-Floskeln (Endlich, wirklich, nicht nur eine Floskel, sprechen eine klare Sprache, Machen Sie noch heute den ersten Schritt).
Erfinde nichts. Keine neuen Leistungen, Zahlen oder Bewertungen.
Anrede, Tonalität und verbotene Wörter aus den Vorgaben gelten weiter.
Antworte nur mit den Abschnitten als HTML, genau in der gelieferten Form: jeder Abschnitt als <section data-block-id="…"> mit seiner Überschrift unverändert und darin dem neu formulierten Text (<p>, <ul>/<ol>/<li>, <strong>, <em>). Keine Erklärungen, kein Markdown, keine Code-Zäune.`;

/** What the step row stores while and after it runs. */
export type RephraseProgress = {
  version: 1;
  /** Rewritten body HTML by block id. */
  rewritten: Record<string, string>;
  /** How many blocks need a rewrite in this text. */
  total: number;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_eur: number;
  models: string[];
  /** Models that ran into the chunk time limit; later chunks and attempts leave them out. */
  slow_models: string[];
};

/** A model that took at least this long before the time limit hit counts as too slow for this page. */
export const REPHRASE_SLOW_MODEL_MS = 60_000;

export function emptyRephraseProgress(total: number): RephraseProgress {
  return { version: 1, rewritten: {}, total, calls: 0, input_tokens: 0, output_tokens: 0, cost_eur: 0, models: [], slow_models: [] };
}

/** The candidates for the next call: the slow ones last, never none. */
export function rephraseModelOrder(candidates: readonly string[], slowModels: readonly string[]): string[] {
  const fast = candidates.filter((m) => !slowModels.includes(m));
  return fast.length > 0 ? [...fast, ...candidates.filter((m) => slowModels.includes(m))] : [...candidates];
}

function num(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
}

/** The progress a step row holds, or a fresh one; anything odd in the row counts as nothing done. */
export function readRephraseProgress(output: unknown, total: number): RephraseProgress {
  const fresh = emptyRephraseProgress(total);
  if (!output || typeof output !== "object" || Array.isArray(output)) return fresh;
  const r = output as Record<string, unknown>;
  if (r.version !== 1 || !r.rewritten || typeof r.rewritten !== "object" || Array.isArray(r.rewritten)) return fresh;
  const rewritten: Record<string, string> = {};
  for (const [id, html] of Object.entries(r.rewritten as Record<string, unknown>)) {
    if (typeof html === "string" && html.trim()) rewritten[id] = html;
  }
  return {
    version: 1,
    rewritten,
    total,
    calls: Math.round(num(r.calls)),
    input_tokens: Math.round(num(r.input_tokens)),
    output_tokens: Math.round(num(r.output_tokens)),
    cost_eur: num(r.cost_eur),
    models: Array.isArray(r.models) ? r.models.filter((m): m is string => typeof m === "string") : [],
    slow_models: Array.isArray(r.slow_models) ? r.slow_models.filter((m): m is string => typeof m === "string") : [],
  };
}

export function blockPlainText(block: Pick<ContentTextBlock, "html">): string {
  return block.html
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Blocks with real body text; the H1, the hero sentence and one-liners are left as they are. */
export function needsRephrase(block: ContentTextBlock): boolean {
  return blockPlainText(block).length >= MIN_TEXT_CHARS;
}

/** How many blocks of a text the step rewrites: the `total` of its progress. */
export function rephraseBlockCount(blocks: readonly ContentTextBlock[]): number {
  return blocks.filter(needsRephrase).length;
}

/**
 * Consecutive groups of blocks still to rewrite, each small enough for one quick call.
 * Blocks already in `done` are skipped, so a resumed run only pays for what is left.
 */
export function planRephraseChunks(blocks: readonly ContentTextBlock[], done: Record<string, string> = {}): ContentTextBlock[][] {
  const chunks: ContentTextBlock[][] = [];
  let current: ContentTextBlock[] = [];
  let currentChars = 0;
  for (const block of blocks) {
    if (!needsRephrase(block) || done[block.id]) continue;
    const chars = blockPlainText(block).length;
    if (current.length > 0 && (currentChars + chars > REPHRASE_CHUNK_CHARS || current.length >= MAX_CHUNK_BLOCKS)) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(block);
    currentChars += chars;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** The chunk as the model receives it: the stored section HTML, headings included. */
export function rephraseChunkHtml(chunk: readonly ContentTextBlock[]): string {
  return renderBlocksHtml(chunk);
}

/** Room for the rewritten HTML of a chunk: generous, so a longer phrasing is never cut. */
export function rephraseChunkMaxTokens(chunk: readonly ContentTextBlock[]): number {
  const chars = chunk.reduce((sum, b) => sum + b.html.length, 0);
  return Math.min(6_000, Math.max(1_000, Math.ceil(chars / 2) + 500));
}

/**
 * The rephrased blocks over the previous ones: ids, headings, levels and order come from the
 * previous text (a question heading stays a question, a dropped block comes back), only the
 * body HTML is taken from the answer. Blocks are matched by id, or by position when the
 * answer renamed them but kept the count.
 */
export function mergeRewrittenBlocks(previous: readonly ContentTextBlock[], output: readonly ContentTextBlock[]): ContentTextBlock[] {
  if (previous.length === 0) return [...output];
  const byId = new Map(output.map((b) => [b.id, b]));
  const positional = output.length === previous.length;
  return previous.map((prev, index) => {
    const candidate = byId.get(prev.id) ?? (positional ? output[index] : undefined);
    const html = candidate?.html.trim() ? candidate.html : prev.html;
    return { ...prev, html };
  });
}

/**
 * Grok's answer for one chunk → the chunk's blocks with new body HTML. Sections are read
 * by their id (headings in the answer are ignored), the HTML is sanitised like every
 * model output, a section the answer lost keeps its old text. A single block answered as
 * bare paragraphs counts too.
 */
export function parseRephrasedChunk(answer: string, chunk: readonly ContentTextBlock[]): ContentTextBlock[] {
  const text = stripCodeFences(answer.trim());
  let blocks = parseBlocksFromHtml(text)
    .map((b) => ({ ...b, html: sanitizeBlockHtml(b.html) }))
    .filter((b) => b.html.trim());
  if (blocks.length === 0 && chunk.length === 1 && /<(p|ul|ol)[\s>]/i.test(text)) {
    const body = text.replace(/^\s*<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>/i, "");
    const html = sanitizeBlockHtml(body);
    if (html.trim()) blocks = [{ ...chunk[0]!, html }];
  }
  return mergeRewrittenBlocks(chunk, blocks);
}

/** The whole page after the step: every block with its rewritten body, the rest untouched. */
export function rephrasedBlocks(previous: readonly ContentTextBlock[], rewritten: Record<string, string>): ContentTextBlock[] {
  return previous.map((block) => (rewritten[block.id]?.trim() ? { ...block, html: rewritten[block.id]! } : block));
}

/** „4 von 11 Abschnitten“ for the status line while the step runs; null without progress. */
export function rephraseProgressLabel(output: unknown): string | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const r = output as Record<string, unknown>;
  if (r.version !== 1 || !r.rewritten || typeof r.rewritten !== "object") return null;
  const total = Math.round(num(r.total));
  if (total <= 0) return null;
  const done = Math.min(total, Object.keys(r.rewritten as Record<string, unknown>).length);
  return `${done} von ${total} Abschnitten`;
}
