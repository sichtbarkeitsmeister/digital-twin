/**
 * The text as it was after one step of a page („Zwischenstand“): what the step's row holds
 * (`dt_content_steps.output`), read back into Abschnitte. Lets the editors see whether a text was
 * weak after SEO already or lost something in a later step. Pure; the route renders the result.
 *
 * The row keeps the step's own answer. What the page stores after a step can differ in details
 * the code adds on top (the [DATUM] marker, the confirmed spelling of contact data).
 */
import { CONTENT_STEPS, contentStepDefinition } from "@/lib/dt/content/pipeline/steps";
import { htmlToPlainText, normalizeBlocks, renderBlocksHtml, type ContentTextBlock } from "@/lib/dt/content/render";

type StepRowLike = { step: number; status: string; output: unknown };

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function ownBlocks(row: StepRowLike | undefined): ContentTextBlock[] | null {
  if (!row || (row.status !== "done" && row.status !== "waiting")) return null;
  const blocks = normalizeBlocks(rec(row.output).blocks, { overLimit: "cut" });
  return blocks.length > 0 ? blocks : null;
}

/** The last step before `step` whose row holds a text; null when none does. */
function previousTextStep(steps: readonly StepRowLike[], step: number): { step: number; blocks: ContentTextBlock[] } | null {
  for (const def of [...CONTENT_STEPS].reverse()) {
    if (def.step >= step || !def.writesText) continue;
    const blocks = stepTextBlocks(steps, def.step);
    if (blocks) return { step: def.step, blocks };
  }
  return null;
}

/**
 * The Abschnitte after `step`, or null when its row holds no text: a step that writes none
 * (Analyse, Faktencheck, Endabnahme), one that has not run, was switched off or was reset.
 * The Watermark Entfernung stores only the rewritten bodies by id; its text is the text before
 * it with those bodies swapped in (headings, ids and levels never change there).
 */
export function stepTextBlocks(steps: readonly StepRowLike[], step: number): ContentTextBlock[] | null {
  const def = contentStepDefinition(step);
  if (!def?.writesText) return null;
  const row = steps.find((s) => s.step === step);
  if (def.provider !== "xai") return ownBlocks(row);
  if (!row || row.status !== "done") return null;
  const rewritten = rec(rec(row.output).rewritten);
  const before = previousTextStep(steps, step);
  if (!before || Object.keys(rewritten).length === 0) return null;
  return before.blocks.map((b) => (typeof rewritten[b.id] === "string" && (rewritten[b.id] as string).trim() ? { ...b, html: rewritten[b.id] as string } : b));
}

/** Whether the step's row holds a text the page window can show. */
export function stepHasText(steps: readonly StepRowLike[], step: number): boolean {
  return stepTextBlocks(steps, step) !== null;
}

export type ContentStepText = {
  step: number;
  name: string;
  html: string;
  title: string | null;
  meta_description: string | null;
  sections: number;
  words: number;
  /** The step before this one that wrote a text, by name; null for the first text. */
  compared_to: string | null;
  /** Abschnitte that are new or read differently than after `compared_to`. */
  changed_block_ids: string[];
  /** Abschnitte the text before had and this one no longer has, by heading (or id). */
  removed_sections: string[];
  /** Words more (+) or fewer (−) than after `compared_to`; null for the first text. */
  words_delta: number | null;
};

function wordCount(blocks: readonly ContentTextBlock[]): number {
  const text = blocks.map((b) => `${b.heading ?? ""} ${htmlToPlainText(b.html)}`).join(" ");
  return (text.match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu) ?? []).length;
}

function sameText(a: ContentTextBlock, b: ContentTextBlock): boolean {
  const plain = (block: ContentTextBlock) => `${block.heading ?? ""}\n${htmlToPlainText(block.html)}`.replace(/\s+/g, " ").trim();
  return a.level === b.level && plain(a) === plain(b);
}

/** The text after `step` with what changed against the text step before it; null when the row holds no text. */
export function contentStepText(steps: readonly StepRowLike[], step: number): ContentStepText | null {
  const blocks = stepTextBlocks(steps, step);
  const def = contentStepDefinition(step);
  if (!blocks || !def) return null;
  const output = rec(steps.find((s) => s.step === step)?.output);
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const before = previousTextStep(steps, step);
  const beforeById = new Map((before?.blocks ?? []).map((b) => [b.id, b]));
  const ids = new Set(blocks.map((b) => b.id));
  return {
    step,
    name: def.name,
    html: renderBlocksHtml(blocks),
    title: text(output.title),
    meta_description: text(output.meta_description),
    sections: blocks.length,
    words: wordCount(blocks),
    compared_to: before ? (contentStepDefinition(before.step)?.name ?? null) : null,
    changed_block_ids: before ? blocks.filter((b) => !beforeById.has(b.id) || !sameText(beforeById.get(b.id)!, b)).map((b) => b.id) : [],
    removed_sections: (before?.blocks ?? []).filter((b) => !ids.has(b.id)).map((b) => b.heading?.trim() || b.id),
    words_delta: before ? wordCount(blocks) - wordCount(before.blocks) : null,
  };
}
