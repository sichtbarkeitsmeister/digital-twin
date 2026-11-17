/**
 * Duplicate content between the finished texts of one website. Pure (no model, no database): the
 * Texte page's „Doppelte Inhalte“ card, the Endabnahme and the API all use it.
 *
 * Every paragraph and list item of every text is compared with those of the other pages by shared
 * runs of four words. „Gleich“: nearly the same paragraph (80 % of the shorter one's runs shared);
 * „ähnlich“: half of it. A paragraph that sits on four or more pages in the same words is a
 * standard text (contact call, disclaimer): shown apart, not counted as duplicate.
 */

import { parseBlocksFromHtml } from "@/lib/dt/content/render";
import type { ContentFinding } from "@/lib/dt/content/types";

export type DuplicateLevel = "gleich" | "aehnlich";

export type DuplicateInputPage = { slug: string; name: string; html: string };

export type ParagraphRef = {
  slug: string;
  name: string;
  blockId: string;
  heading: string | null;
  text: string;
  words: number;
};

export type DuplicateMatch = {
  a: ParagraphRef;
  b: ParagraphRef;
  /** Share of the shorter paragraph's four-word runs that both have (0–1). */
  similarity: number;
  level: DuplicateLevel;
};

export type DuplicatePair = {
  a: { slug: string; name: string; words: number };
  b: { slug: string; name: string; words: number };
  matches: DuplicateMatch[];
  /** Words of the page's paragraphs that have a match on the other page, as a share of its words (0–1). */
  shareA: number;
  shareB: number;
  level: DuplicateLevel;
};

export type StandardText = { text: string; pages: Array<{ slug: string; name: string }> };

export type DuplicateReport = {
  pages: number;
  paragraphs: number;
  pairs: DuplicatePair[];
  standardTexts: StandardText[];
};

const MIN_WORDS = 8;
const SHINGLE = 4;
const GLEICH = 0.8;
const AEHNLICH = 0.5;
const MIN_SHARED = 3;
/** The Endabnahme lists a single paragraph only when this much of it is shared; two alike paragraphs are listed always. */
const LISTED_SIMILARITY = 0.6;
/** A run seen in more paragraphs than this is no useful clue (a stock phrase): skipped in the index. */
const POSTING_CAP = 30;
/** The same paragraph on this many pages is a standard text. */
const STANDARD_PAGES = 4;
const EXCERPT = 240;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function plain(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

type Para = ParagraphRef & { normalized: string; shingles: Set<string> };

/** The paragraphs and list items of a text, by Abschnitt; headings are not compared. */
function paragraphsOf(page: DuplicateInputPage): Para[] {
  const out: Para[] = [];
  for (const block of parseBlocksFromHtml(page.html)) {
    for (const match of block.html.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const text = plain(match[2] ?? "");
      const w = words(text);
      if (w.length < MIN_WORDS) continue;
      const shingles = new Set<string>();
      for (let i = 0; i + SHINGLE <= w.length; i++) shingles.add(w.slice(i, i + SHINGLE).join(" "));
      out.push({ slug: page.slug, name: page.name, blockId: block.id, heading: block.heading, text, words: w.length, normalized: w.join(" "), shingles });
    }
  }
  return out;
}

const ref = (p: Para): ParagraphRef => ({ slug: p.slug, name: p.name, blockId: p.blockId, heading: p.heading, text: p.text.length > EXCERPT ? `${p.text.slice(0, EXCERPT).trimEnd()} …` : p.text, words: p.words });

export function findDuplicateContent(pages: readonly DuplicateInputPage[]): DuplicateReport {
  const paras = pages.flatMap(paragraphsOf);
  const totalWords = new Map<string, number>();
  for (const p of paras) totalWords.set(p.slug, (totalWords.get(p.slug) ?? 0) + p.words);

  // Standard texts: the same paragraph (word for word) on several pages.
  const byText = new Map<string, Para[]>();
  for (const p of paras) byText.set(p.normalized, [...(byText.get(p.normalized) ?? []), p]);
  const standardKeys = new Set<string>();
  const standardTexts: StandardText[] = [];
  for (const [key, list] of byText) {
    const distinct = [...new Map(list.map((p) => [p.slug, p])).values()];
    if (distinct.length >= STANDARD_PAGES) {
      standardKeys.add(key);
      standardTexts.push({ text: ref(distinct[0]!).text, pages: distinct.map((p) => ({ slug: p.slug, name: p.name })) });
    }
  }
  standardTexts.sort((x, y) => y.pages.length - x.pages.length);

  const index = new Map<string, number[]>();
  paras.forEach((p, i) => {
    for (const s of p.shingles) index.set(s, [...(index.get(s) ?? []), i]);
  });

  const pairs = new Map<string, { a: Para["slug"]; b: Para["slug"]; matches: DuplicateMatch[]; aWords: Set<number>; bWords: Set<number> }>();
  paras.forEach((p, i) => {
    const shared = new Map<number, number>();
    for (const s of p.shingles) {
      const postings = index.get(s)!;
      if (postings.length > POSTING_CAP) continue;
      for (const j of postings) if (j > i && paras[j]!.slug !== p.slug) shared.set(j, (shared.get(j) ?? 0) + 1);
    }
    for (const [j, count] of shared) {
      const q = paras[j]!;
      if (standardKeys.has(p.normalized) && standardKeys.has(q.normalized)) continue;
      const similarity = count / Math.min(p.shingles.size, q.shingles.size);
      if (count < MIN_SHARED || similarity < AEHNLICH) continue;
      const [first, second, firstPara, secondPara] = p.slug < q.slug ? [p.slug, q.slug, p, q] : [q.slug, p.slug, q, p];
      const key = `${first}|${second}`;
      const entry = pairs.get(key) ?? { a: first, b: second, matches: [], aWords: new Set<number>(), bWords: new Set<number>() };
      entry.matches.push({ a: ref(firstPara), b: ref(secondPara), similarity: Math.min(1, similarity), level: similarity >= GLEICH ? "gleich" : "aehnlich" });
      entry.aWords.add(paras.indexOf(firstPara));
      entry.bWords.add(paras.indexOf(secondPara));
      pairs.set(key, entry);
    }
  });

  const names = new Map(pages.map((p) => [p.slug, p.name]));
  const sumWords = (set: Set<number>) => [...set].reduce((n, idx) => n + paras[idx]!.words, 0);
  const result: DuplicatePair[] = [...pairs.values()].map((entry) => {
    const wordsA = totalWords.get(entry.a) ?? 1;
    const wordsB = totalWords.get(entry.b) ?? 1;
    entry.matches.sort((x, y) => y.similarity - x.similarity);
    return {
      a: { slug: entry.a, name: names.get(entry.a) ?? entry.a, words: wordsA },
      b: { slug: entry.b, name: names.get(entry.b) ?? entry.b, words: wordsB },
      matches: entry.matches,
      shareA: Math.min(1, sumWords(entry.aWords) / wordsA),
      shareB: Math.min(1, sumWords(entry.bWords) / wordsB),
      level: entry.matches.some((m) => m.level === "gleich") ? "gleich" : "aehnlich",
    };
  });
  result.sort((x, y) => Math.max(y.shareA, y.shareB) - Math.max(x.shareA, x.shareB) || y.matches.length - x.matches.length);
  return { pages: pages.length, paragraphs: paras.length, pairs: result, standardTexts };
}

/** How strong a pair is, by the larger share of either text. */
export function duplicateSeverity(pair: Pick<DuplicatePair, "shareA" | "shareB">): "hoch" | "mittel" | "gering" {
  const share = Math.max(pair.shareA, pair.shareB);
  return share >= 0.3 ? "hoch" : share >= 0.1 ? "mittel" : "gering";
}

const pct = (share: number) => `${Math.max(1, Math.round(share * 100))} %`;

/**
 * The open points one page gets from the duplicates (the Endabnahme lists them for the release): one
 * per other page that repeats its paragraphs, if at least one paragraph is nearly the same or two are alike.
 */
export function duplicateFindingsForPage(report: DuplicateReport, slug: string): ContentFinding[] {
  const out: ContentFinding[] = [];
  for (const pair of report.pairs) {
    if (pair.a.slug !== slug && pair.b.slug !== slug) continue;
    const mine = pair.a.slug === slug ? "a" : "b";
    const other = mine === "a" ? pair.b : pair.a;
    const ownShare = mine === "a" ? pair.shareA : pair.shareB;
    const strong = pair.matches.some((m) => m.similarity >= LISTED_SIMILARITY) || pair.matches.length >= 2;
    if (!strong) continue;
    const first = pair.matches[0]!;
    const here = mine === "a" ? first.a : first.b;
    const there = mine === "a" ? first.b : first.a;
    const severity = duplicateSeverity(pair);
    out.push({
      title: `Doppelter Inhalt mit „${other.name}“`,
      problem: `${pair.matches.length} ${pair.matches.length === 1 ? "Absatz steht" : "Absätze stehen"} fast gleich auch auf der Seite „${other.name}“ (etwa ${pct(ownShare)} dieses Textes). Beispiel: „${here.text}“ – dort: „${there.text}“`,
      proposal: `Den Absatz hier eigenständig und passend zum Thema dieser Seite formulieren oder stattdessen auf „${other.name}“ verlinken. Dieselben Aussagen auf zwei Seiten konkurrieren in der Suche.`,
      severity: severity === "hoch" ? "high" : "medium",
      severity_label: severity === "hoch" ? "Hoch" : "Mittel",
      block_id: here.blockId,
    });
  }
  return out;
}
