/**
 * Which open point is which, and which Abschnitt it is about: shared by the page window (client)
 * and the revision routes. Pure; no prompts, no model.
 */
import { htmlToPlainText, type ContentTextBlock } from "@/lib/dt/content/render";
import type { ContentFinding } from "@/lib/dt/content/types";

const MARKER_RE = /\[\s*(?:BITTE\s+PR(?:Ü|UE)FEN|QUELLE\s+BITTE|PREIS\s+BITTE|LINK\s*:|DATUM|FOTO\s*:|HERO)[^\]]*\]/giu;

function plain(block: Pick<ContentTextBlock, "heading" | "html">): string {
  return `${block.heading ?? ""}\n${htmlToPlainText(block.html)}`.replace(/[ \t]+/g, " ");
}

function markers(text: string): string[] {
  return [...text.matchAll(MARKER_RE)].map((m) => m[0].replace(/\s+/g, " ").trim());
}

/** The key the page window uses for an open point (title, Abschnitt, problem). */
export function findingKey(f: Pick<ContentFinding, "title" | "block_id" | "problem">): string {
  return `${f.title}|${f.block_id ?? ""}|${f.problem}`;
}

/** The three lists without the open point; null when it is in none of them. */
export function withoutFinding(
  page: { findings: readonly ContentFinding[]; final_findings: readonly ContentFinding[]; unresolved: readonly ContentFinding[] },
  key: string,
): { findings: ContentFinding[]; final_findings: ContentFinding[]; unresolved: ContentFinding[] } | null {
  const keep = (list: readonly ContentFinding[]) => list.filter((f) => findingKey(f) !== key);
  const next = { findings: keep(page.findings), final_findings: keep(page.final_findings), unresolved: keep(page.unresolved) };
  const removed = page.findings.length + page.final_findings.length + page.unresolved.length - (next.findings.length + next.final_findings.length + next.unresolved.length);
  return removed > 0 ? next : null;
}

/**
 * Every Abschnitt an open point is about, in the order the text names them: its block, the ones
 * holding a placeholder or a quoted sentence the problem or proposal names (a quote cut off with
 * „…“ counts by the part before it), and Abschnitte named by heading or id („Abschnitt „Ablauf““,
 * „Im Abschnitt verlauf-2“). Empty when nothing in the text points to one.
 */
export function findingTargetBlocks(f: Pick<ContentFinding, "block_id" | "problem" | "proposal">, blocks: readonly Pick<ContentTextBlock, "id" | "heading" | "html">[]): string[] {
  const text = `${f.problem} ${f.proposal}`;
  const texts = blocks.map((b) => ({ id: b.id, text: plain(b).replace(/\s+/g, " ") }));
  const hits: Array<{ at: number; id: string }> = [];
  if (f.block_id && blocks.some((b) => b.id === f.block_id)) hits.push({ at: -1, id: f.block_id });
  for (const m of markers(text)) {
    const hit = texts.find((b) => b.text.includes(m));
    if (hit) hits.push({ at: text.indexOf(m), id: hit.id });
  }
  for (const quote of text.matchAll(/„([^“]{12,400})“/g)) {
    // A quote cut off with „…“ / „...“: the part before it (at least 12 characters) must match.
    const part = quote[1]!.split(/\s*(?:…|\.\.\.)\s*/).map((p) => p.replace(/\s+/g, " ").trim().replace(/[\s:;,]+$/, "")).find((p) => p.length >= 12);
    if (!part) continue;
    const needle = part.slice(0, 60);
    const hit = texts.find((b) => b.text.includes(needle));
    if (hit) hits.push({ at: quote.index ?? 0, id: hit.id });
  }
  for (const section of text.matchAll(/Abschnitt(?:s|e|en)?\s+„([^“]{2,120})“/g)) {
    const name = section[1]!.trim();
    const hit = blocks.find((b) => (b.heading ?? "").trim() === name || b.id === name);
    if (hit) hits.push({ at: section.index ?? 0, id: hit.id });
  }
  // Ids named bare: „Im Abschnitt verlauf-2 steht …“, „vertrauen-5: …“.
  const ids = new Set(blocks.map((b) => b.id));
  for (const word of text.matchAll(/(?<![\p{L}\d_-])([a-z][a-z0-9]*(?:[-_][a-z0-9]+)*)(?=[\s:,.;)]|$)/gu)) {
    const id = word[1]!;
    if (!ids.has(id)) continue;
    const before = text.slice(Math.max(0, (word.index ?? 0) - 12), word.index ?? 0);
    const after = text.slice((word.index ?? 0) + id.length, (word.index ?? 0) + id.length + 2);
    // Only where it reads as a name: after „Abschnitt“, or as „id: …“ at the start of a quote reference.
    // A distinctive id (with a hyphen or a digit, like „verlauf-2“) also after „In“/„Im“.
    const distinct = /[-_\d]/.test(id) && /\b(?:In|in|Im|im)\s+$/.test(before);
    if (/Abschnitt(?:s|e|en)?\s+$/.test(before) || /^:\s/.test(after) || distinct) hits.push({ at: word.index ?? 0, id });
  }
  const out: string[] = [];
  for (const h of hits.sort((a, b) => a.at - b.at)) if (!out.includes(h.id)) out.push(h.id);
  return out;
}

/** The first Abschnitt an open point is about (see `findingTargetBlocks`); null when none. */
export function findingTargetBlock(f: Pick<ContentFinding, "block_id" | "problem" | "proposal">, blocks: readonly Pick<ContentTextBlock, "id" | "heading" | "html">[]): string | null {
  return findingTargetBlocks(f, blocks)[0] ?? null;
}

function sentenceKey(sentence: string): string {
  return sentence.toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim();
}

/** Sentences of a plain text (paragraph breaks kept as their own entries). */
function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ„"(\d])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The revised Abschnitt's text sentence by sentence, each marked when it was not in the Abschnitt
 * before: the preview shows at a glance what the model wrote new (and checks no fact for it).
 */
export function markNewSentences(beforeText: string, afterText: string): Array<{ text: string; isNew: boolean }> {
  const before = new Set(sentences(beforeText).map(sentenceKey));
  return sentences(afterText).map((text) => ({ text, isNew: !before.has(sentenceKey(text)) }));
}
