/**
 * Missing facts in a page text, found in code rather than by asking the model: the
 * placeholders the steps write for what only the customer knows. Pure, so the halting rule
 * in `step-patch.ts` is testable without Supabase.
 *
 * A gap is
 *   [BITTE PRÜFEN: …]   [QUELLE BITTE ERGÄNZEN]   [PREIS BITTE PRÜFEN UND ANPASSEN…]
 * Not a gap (wanted markers): [LINK: …], [DATUM], [FOTO: …] and the hero placeholder
 * „[HERO – wird in Schritt 5 gefuellt]“, which step 5 replaces.
 */

import { htmlToPlainText, parseBlocksFromHtml, type ContentTextBlock } from "@/lib/dt/content/render";
import type { ContentQuestion } from "@/lib/dt/content/types";

const GAP_RE =
  /\[\s*(?:BITTE\s+PR(?:Ü|UE)FEN\b[^\]]*|QUELLE\s+BITTE\s+ERG(?:Ä|AE)NZEN[^\]]*|PREIS\s+BITTE\s+PR(?:Ü|UE)FEN\s+UND\s+ANPASSEN[^\]]*)\]/giu;

const MAX_EXCERPT_CHARS = 400;

/** One placeholder left in the text, with the Abschnitt it sits in. */
export type ContentGap = {
  block_id: string;
  /** Heading of the Abschnitt, its id when it has none. */
  section: string;
  /** The placeholder as written, e.g. „[BITTE PRÜFEN: Preis pro Stunde]“. */
  placeholder: string;
  question: string;
  /** The sentence around the placeholder. */
  excerpt: string;
};

/** True when the text still holds a placeholder for a fact only the customer knows. */
export function hasContentGap(text: string): boolean {
  GAP_RE.lastIndex = 0;
  const found = GAP_RE.test(text);
  GAP_RE.lastIndex = 0;
  return found;
}

/** The Abschnitt as the table and the drawer name it: its heading, else its id. */
export function contentSectionName(block: Pick<ContentTextBlock, "id" | "heading">): string {
  return block.heading?.replace(/\s+/g, " ").trim() || block.id;
}

/** A short German question for the placeholder. */
export function gapQuestion(placeholder: string): string {
  const inner = placeholder.replace(/^\[\s*|\s*\]$/g, "").replace(/\s+/g, " ").trim();
  const check = inner.match(/^BITTE PR(?:Ü|UE)FEN\b\s*:?\s*(.*)$/iu);
  if (check) {
    const what = (check[1] ?? "").replace(/[.:;,\s]+$/, "").trim();
    if (!what) return "Welche Angabe gehört an diese Stelle?";
    return /\?$/.test(what) ? what : `${what} – was soll hier stehen?`;
  }
  if (/^QUELLE/i.test(inner)) return "Welche Quelle belegt diese Aussage?";
  if (/^PREIS/i.test(inner)) return "Welcher Preis gilt hier?";
  return "Welche Angabe gehört an diese Stelle?";
}

/** The sentence around [start, end): back to the previous sentence end, on to the next one. */
function sentenceAround(text: string, start: number, end: number): string {
  let from = start;
  while (from > 0) {
    const before = text[from - 1]!;
    if (before === "\n") break;
    if (/[.!?]/.test(text[from - 2] ?? "") && /\s/.test(before)) break;
    from -= 1;
  }
  let to = end;
  while (to < text.length) {
    const ch = text[to]!;
    if (ch === "\n") break;
    to += 1;
    if (/[.!?]/.test(ch) && (to >= text.length || /\s/.test(text[to]!))) break;
  }
  const sentence = text.slice(from, to).replace(/\s+/g, " ").trim();
  return sentence.length > MAX_EXCERPT_CHARS ? `${sentence.slice(0, MAX_EXCERPT_CHARS - 1)}…` : sentence;
}

/** Every placeholder gap of the text, in reading order; the same placeholder twice in one Abschnitt counts once. */
export function findContentGaps(blocks: readonly ContentTextBlock[]): ContentGap[] {
  const gaps: ContentGap[] = [];
  for (const block of blocks) {
    const section = contentSectionName(block);
    const seen = new Set<string>();
    const parts = [block.heading ?? "", htmlToPlainText(block.html)];
    for (const text of parts) {
      for (const match of text.matchAll(GAP_RE)) {
        const placeholder = match[0].replace(/\s+/g, " ").trim();
        const key = placeholder.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const start = match.index ?? 0;
        gaps.push({
          block_id: block.id,
          section,
          placeholder,
          question: gapQuestion(placeholder),
          excerpt: sentenceAround(text, start, start + match[0].length),
        });
      }
    }
  }
  return gaps;
}

/** `findContentGaps` on the stored page HTML. */
export function findContentGapsInHtml(html: string): ContentGap[] {
  return html ? findContentGaps(parseBlocksFromHtml(html)) : [];
}

function gapToQuestion(gap: ContentGap): ContentQuestion {
  return {
    kind: "missing",
    question: gap.question,
    field: null,
    placeholder: gap.placeholder,
    block_id: gap.block_id,
    section: gap.section,
    excerpt: gap.excerpt,
    blocking: true,
  };
}

/** Loose comparison so the Faktencheck's own question for a placeholder is not listed twice. */
function looseText(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim();
}

/**
 * The questions a page stops for: the Faktencheck's own (every one, also those it marked
 * non-blocking) and one per placeholder gap of the text. A gap the Faktencheck already asks
 * about in the same Abschnitt is not added again. All of them block, every entry names its
 * Abschnitt (`section`) when it has a block.
 */
export function contentGapQuestions(
  blocks: readonly ContentTextBlock[],
  modelQuestions: readonly ContentQuestion[] = [],
): ContentQuestion[] {
  const sectionOf = new Map(blocks.map((b) => [b.id, contentSectionName(b)]));
  const fromModel: ContentQuestion[] = modelQuestions.map((q) => ({
    ...q,
    section: q.section ?? (q.block_id ? (sectionOf.get(q.block_id) ?? q.block_id) : null),
    blocking: true,
  }));
  const extra: ContentQuestion[] = [];
  for (const gap of findContentGaps(blocks)) {
    const inner = looseText(gap.placeholder.replace(/^\[[^:\]]*:?/, ""));
    const asked = fromModel.find((q) => {
      if (q.block_id && q.block_id !== gap.block_id) return false;
      const said = looseText(`${q.placeholder ?? ""} ${q.excerpt ?? ""} ${q.question}`);
      return said.includes(looseText(gap.placeholder)) || (inner.length > 3 && said.includes(inner));
    });
    if (!asked) {
      extra.push(gapToQuestion(gap));
    } else if (!asked.block_id) {
      // The model asked without naming the Abschnitt: the placeholder tells where it is.
      Object.assign(asked, { block_id: gap.block_id, section: gap.section, excerpt: asked.excerpt || gap.excerpt });
    }
  }
  return [...fromModel, ...extra];
}
