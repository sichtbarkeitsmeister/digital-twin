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
 * Which Abschnitt an open point is about: its block, else the one holding a placeholder or a
 * quoted sentence the problem names. Null when nothing in the text points to one.
 */
export function findingTargetBlock(f: Pick<ContentFinding, "block_id" | "problem" | "proposal">, blocks: readonly Pick<ContentTextBlock, "id" | "heading" | "html">[]): string | null {
  if (f.block_id && blocks.some((b) => b.id === f.block_id)) return f.block_id;
  const text = `${f.problem} ${f.proposal}`;
  const texts = blocks.map((b) => ({ id: b.id, text: plain(b).replace(/\s+/g, " ") }));
  for (const m of markers(text)) {
    const hit = texts.find((b) => b.text.includes(m));
    if (hit) return hit.id;
  }
  for (const quote of text.matchAll(/„([^“]{12,240})“/g)) {
    const needle = quote[1]!.replace(/\s+/g, " ").trim().slice(0, 60);
    const hit = texts.find((b) => b.text.includes(needle));
    if (hit) return hit.id;
  }
  const section = text.match(/Abschnitt „([^“]{2,120})“/);
  if (section) {
    const hit = blocks.find((b) => (b.heading ?? "").trim() === section[1]!.trim() || b.id === section[1]!.trim());
    if (hit) return hit.id;
  }
  return null;
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
