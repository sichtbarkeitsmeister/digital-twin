/**
 * Kontext über Seiten hinweg: what the other pages of the same organisation already use. Every
 * page is written on its own, from the same Anbieterfakten and the same Avatar, so without this
 * the pages open alike, repeat the same headings and tell the same case twice. The SEO step gets a
 * register per page that has a text: its Hero-Überschrift, the first sentence of its
 * Kurzzusammenfassung, its H2/H3 and its Fallbeispiele. Pure (no model, no database).
 */
import { htmlToPlainText, parseBlocksFromHtml, type ContentTextBlock } from "@/lib/dt/content/render";

export type ContentPageUsage = {
  slug: string;
  name: string;
  /** Heading of the Abschnitt „zusammenfassung“ (the Hero-Überschrift). */
  hero: string | null;
  /** First sentence of the Kurzzusammenfassung. */
  einstieg: string | null;
  /** H2 and H3 of the page, without the Hero-Überschrift. */
  headings: string[];
  /** Case examples the page tells, each in its first sentence (the Fallbeispiel-Register). */
  fallbeispiele: string[];
};

const HEADINGS_PER_PAGE = 14;
const CASES_PER_PAGE = 3;
const SENTENCE_MAX_CHARS = 220;
/** The whole block in the prompt; pages that no longer fit are counted, not shown. */
export const USED_ELSEWHERE_MAX_CHARS = 9_000;

const CASE_HEADING_RE = /(?:fall|praxis|kunden|patienten)beispiel|aus (?:der|unserer) praxis|erfahrungsbericht|fallstudie|so lief es bei/i;
const CASE_TEXT_RE = /\b(?:Fallbeispiel|Praxisbeispiel|Ein Beispiel aus|Beispiel aus (?:der|unserer) Praxis|Ein Beispiel:|Zum Beispiel:|Ein(?:e)? (?:Patient(?:in)?|Kund(?:e|in)|Mandant(?:in)?|Familie|Ehepaar|Erbin|Erbe)\b)/;

function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const match = clean.match(/^.*?[.!?](?=\s+[A-ZÄÖÜ„"(\d]|$)/);
  return (match?.[0] ?? clean).slice(0, SENTENCE_MAX_CHARS).trim();
}

function paragraphs(html: string): string[] {
  return html
    .split(/<\/(?:p|li)>/i)
    .map((part) => htmlToPlainText(part).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function heroBlockOf(blocks: readonly ContentTextBlock[]): ContentTextBlock | null {
  return blocks.find((b) => b.id === "zusammenfassung") ?? blocks.find((b, i) => i > 0 && b.level === 2 && Boolean(b.heading)) ?? null;
}

/** What one page uses, read from its stored text. */
export function contentPageUsage(page: { slug: string; name: string; html: string | null | undefined }): ContentPageUsage {
  const blocks = parseBlocksFromHtml(page.html ?? "");
  const hero = heroBlockOf(blocks);
  const cases: string[] = [];
  for (const block of blocks) {
    if (cases.length >= CASES_PER_PAGE) break;
    const parts = paragraphs(block.html);
    if (block.heading && CASE_HEADING_RE.test(block.heading)) {
      const first = firstSentence(parts[0] ?? "");
      cases.push(first ? `${block.heading.trim()}: ${first}` : block.heading.trim());
      continue;
    }
    for (const part of parts) {
      if (cases.length >= CASES_PER_PAGE) break;
      if (CASE_TEXT_RE.test(part)) cases.push(firstSentence(part.slice(Math.max(0, part.search(CASE_TEXT_RE)))));
    }
  }
  return {
    slug: page.slug,
    name: page.name,
    hero: hero?.heading?.trim() || null,
    einstieg: hero ? firstSentence(htmlToPlainText(hero.html)) || null : null,
    headings: blocks
      .filter((b) => (b.level === 2 || b.level === 3) && b.heading && b !== hero)
      .map((b) => b.heading!.trim())
      .slice(0, HEADINGS_PER_PAGE),
    fallbeispiele: [...new Set(cases.filter(Boolean))],
  };
}

/** The register of the other pages: every page with a text except this one. */
export function usedElsewhere(pages: ReadonlyArray<{ slug: string; name: string; html: string | null | undefined }>, ownSlug: string): ContentPageUsage[] {
  return pages
    .filter((p) => p.slug !== ownSlug && (p.html ?? "").trim())
    .map(contentPageUsage)
    .filter((u) => u.hero || u.einstieg || u.headings.length > 0 || u.fallbeispiele.length > 0);
}

function usageLines(u: ContentPageUsage): string {
  return [
    `### Seite „${u.name}“`,
    u.hero ? `Hero-Überschrift: ${u.hero}` : "",
    u.einstieg ? `Einstieg (erster Satz der Kurzzusammenfassung): ${u.einstieg}` : "",
    u.headings.length > 0 ? `Überschriften (H2/H3): ${u.headings.join(" · ")}` : "",
    u.fallbeispiele.length > 0 ? `Fallbeispiele: ${u.fallbeispiele.join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The block for the SEO step; empty when no other page has a text yet. */
export function usedElsewhereBlock(usages: readonly ContentPageUsage[] | null | undefined, max: number = USED_ELSEWHERE_MAX_CHARS): string {
  const list = usages ?? [];
  if (list.length === 0) return "";
  const head = "## Schon verwendet auf anderen Seiten dieses Anbieters (nicht wiederholen)";
  const parts: string[] = [];
  let size = head.length;
  let shown = 0;
  for (const usage of list) {
    const text = usageLines(usage);
    if (size + text.length + 2 > max && shown > 0) break;
    parts.push(text);
    size += text.length + 2;
    shown += 1;
  }
  const rest = list.length - shown;
  return [head, ...parts, ...(rest > 0 ? [`(${rest} weitere ${rest === 1 ? "Seite" : "Seiten"} mit Text nicht gezeigt.)`] : [])].join("\n\n");
}

/** Fixed rule of the SEO step when other pages have a text. */
export const USED_ELSEWHERE_RULES = `Kontext über Seiten hinweg (feste Regel): Der Block „Schon verwendet auf anderen Seiten dieses Anbieters“ nennt je Seite Hero-Überschrift, Einstieg, H2/H3 und Fallbeispiele. Diese Seite wiederholt nichts davon: Ihre Hero-Überschrift und der erste Satz ihrer Kurzzusammenfassung gleichen keinem Eintrag, auch nicht mit ausgetauschtem Keyword oder umgestellten Wörtern; ihre H2 und H3 sind eigene Formulierungen zu den Themen dieser Seite; ein Fallbeispiel, das dort steht, wird hier nicht noch einmal erzählt (ein Satz mit Verweis genügt, wenn eine erlaubte Verlinkung auf die Seite besteht). Gleich bleiben dürfen nur Überschriften, die die Seitentyp-Vorlage wörtlich vorgibt. Auch die hero_kandidaten halten sich daran.`;
