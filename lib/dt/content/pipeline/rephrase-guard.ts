/**
 * The code check after the Watermark Entfernung, per Abschnitt: what Grok must not lose or add.
 * Every number of the old text (with €, %, years and dates) stays, no number comes in, every
 * placeholder stays, and so do the protected names: the company, the Ansprechpartner, street and
 * town from the Kontaktdaten, the page's main and secondary keywords, and brand-like words of the
 * old text (all capitals like „IWC“, a capital inside the word like „iPhone“). A section that
 * fails keeps its previous wording and becomes the open point „Umformulierung verworfen: …“.
 *
 * Written-out numbers count strictly: „drei“ → „3“ is a new number.
 */
import type { ContactPromptData } from "@/lib/dt/contact-data";
import type { AnalyseOutput } from "@/lib/dt/content/pipeline/prompts";
import { CONTENT_STEP_ANALYSE } from "@/lib/dt/content/pipeline/steps";
import { htmlToPlainText, type ContentTextBlock } from "@/lib/dt/content/render";
import type { ContentFinding } from "@/lib/dt/content/types";

const MARKER_RE = /\[\s*(?:BITTE\s+PR(?:Ü|UE)FEN|QUELLE|PREIS\s+BITTE|LINK\s*:|DATUM|FOTO\s*:|HERO)[^\]]*\]/giu;
const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
/** All capitals (2+ letters) or a capital after a small letter inside the word. */
const BRAND_RE = /(?<![\p{L}\d])(?:\p{Lu}{2,}[\p{Lu}\d]*|\p{L}*\p{Ll}\p{Lu}\p{L}*)(?![\p{L}\d])/gu;

function plain(block: Pick<ContentTextBlock, "html">): string {
  return htmlToPlainText(block.html).replace(/\s+/g, " ").trim();
}

function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function markers(text: string): string[] {
  return [...text.matchAll(MARKER_RE)].map((m) => m[0].replace(/\s+/g, " ").trim());
}

/** Digits without their separators: „1.500“ and „1500“ are the same number. */
function numbers(text: string): string[] {
  return (text.replace(MARKER_RE, " ").match(NUMBER_RE) ?? []).map((n) => n.replace(/[.,]/g, ""));
}

function brands(text: string): string[] {
  return [...new Set(text.replace(MARKER_RE, " ").match(BRAND_RE) ?? [])];
}

/** The protected names of a Texte page: Kontaktdaten (company, person, street, town) and the keywords. */
export function rephraseProtectedTerms(context: {
  contact?: ContactPromptData | null;
  page?: { keywords?: { main: { text: string }; secondary: Array<{ text: string }> } | null; main_keyword?: string | null } | null;
  outputs?: Record<number, unknown>;
}): string[] {
  const terms: string[] = [];
  for (const line of context.contact?.lines ?? []) {
    if (line.label === "Firmenname") terms.push(line.value);
    if (line.label === "Ansprechpartner") terms.push(line.value.replace(/\s*\([^)]*\)\s*$/, ""));
    if (line.label === "Adresse") {
      const [street, city] = line.value.split(/,\s*/);
      if (street) terms.push(street.replace(/\s*\d+\s*[a-z]?(?:\s*[-–]\s*\d+\s*[a-z]?)?$/i, ""));
      if (city) terms.push(city.replace(/^\d{4,5}\s*/, ""));
    }
  }
  const analyse = context.outputs?.[CONTENT_STEP_ANALYSE] as Partial<AnalyseOutput> | undefined;
  terms.push(
    context.page?.keywords?.main.text ?? "",
    ...(context.page?.keywords?.secondary.map((k) => k.text) ?? []),
    context.page?.main_keyword ?? "",
    analyse?.main_keyword ?? "",
    ...(Array.isArray(analyse?.secondary_keywords) ? analyse.secondary_keywords : []),
  );
  const seen = new Set<string>();
  return terms
    .map((t) => (typeof t === "string" ? t.replace(/\s+/g, " ").trim() : ""))
    .filter((t) => t.length >= 2 && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

/**
 * What Grok's version of one Abschnitt lost or added, in words for the open point; empty when it
 * may stay. Only what is in the old text is checked (a keyword the section never had is no loss).
 */
export function rephraseLosses(before: Pick<ContentTextBlock, "html">, after: Pick<ContentTextBlock, "html">, terms: readonly string[]): string[] {
  const was = plain(before);
  const now = plain(after);
  if (was === now) return [];
  const losses: string[] = [];

  const nowNumbers = new Set(numbers(now));
  const wasNumbers = new Set(numbers(was));
  const lostNumbers = [...wasNumbers].filter((n) => !nowNumbers.has(n));
  if (lostNumbers.length > 0) losses.push(`Zahl ${lostNumbers.join(", ")}`);
  const newNumbers = [...nowNumbers].filter((n) => !wasNumbers.has(n));
  if (newNumbers.length > 0) losses.push(`neue Zahl ${newNumbers.join(", ")}`);

  const nowMarkers = markers(now);
  const lostMarkers = [...new Set(markers(was))].filter((m) => !nowMarkers.includes(m));
  if (lostMarkers.length > 0) losses.push(`Platzhalter ${lostMarkers.join(", ")}`);

  const nowNorm = norm(now);
  const wasNorm = norm(was);
  const lostTerms = terms.filter((t) => wasNorm.includes(norm(t)) && !nowNorm.includes(norm(t)));
  const lostBrands = brands(was).filter((b) => !now.includes(b) && !lostTerms.some((t) => norm(t).includes(norm(b))));
  const names = [...lostTerms, ...lostBrands];
  if (names.length > 0) losses.push(`Name oder Keyword ${names.map((n) => `„${n}“`).join(", ")}`);
  return losses;
}

/** The open points of the sections whose new wording was thrown away. */
export function rephraseRejectedFindings(
  rejected: ReadonlyArray<{ block_id: string; missing: string }>,
  blocks: ReadonlyArray<Pick<ContentTextBlock, "id" | "heading">>,
): ContentFinding[] {
  const names = new Map(blocks.map((b) => [b.id, b.heading?.trim() || b.id]));
  return rejected.map((r) => ({
    title: `Umformulierung verworfen: ${r.missing}`.slice(0, 160),
    problem: `Grok hat beim Abschnitt „${names.get(r.block_id) ?? r.block_id}“ etwas verloren oder hinzugefügt (${r.missing}). Die Umformulierung wurde verworfen; der Abschnitt steht so da wie vor der Watermark Entfernung.`,
    proposal: "So lassen oder den Abschnitt überarbeiten lassen.",
    severity: "low",
    severity_label: "Hinweis",
    block_id: r.block_id,
  }));
}
