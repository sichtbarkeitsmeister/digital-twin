/**
 * „Faktenauszug“: what the customer's conversations (workshop transcripts and summaries) say
 * about the topic of one page. The steps used to read only the Anbieter evaluation, thirteen
 * sections for the whole company; what a workshop said about one Leistung in detail rarely
 * reached the page about it. The excerpt is made once per page, before the Analyse
 * (`page-facts.ts`), only with an approved and current Anbieter evaluation, which goes before
 * the conversations and whose blocked statements (`blocked.ts`) are never pulled; stored in the Analyse's step row under `page_facts` (no migration) and
 * goes into every prompt that carries the Anbieterfakten. Pure; safe for client code and tests.
 */

export const PAGE_FACTS_MAX = 60;
const FACT_MAX_CHARS = 700;
const QUOTE_MAX_CHARS = 400;
export const PAGE_FACTS_GAPS_MAX = 10;

export type ContentPageFact = {
  /** The fact as the conversation states it, one to three sentences. */
  fact: string;
  /** Sub-topic in a few words („Ablauf“, „Preis“, „Einwand“). */
  topic: string;
  /** Which conversation says it („Gespräch 2“). */
  source: string;
  /** The speaker's own wording, when it is worth keeping; empty otherwise. */
  quote: string;
};

export type ContentPageFacts = {
  facts: ContentPageFact[];
  /** What the page would need but no conversation says. */
  gaps: string[];
  /** How many conversations were read (0: the organisation has none, no call was made). */
  conversations: number;
  /** The conversations were longer than one call can read; their wording was shortened. */
  shortened: boolean;
  /** Why there is no excerpt although there are conversations (the call failed); null otherwise. */
  error: string | null;
  /**
   * Why no excerpt was made on purpose: the Anbieter evaluation is not approved, or a
   * conversation is newer than it. Nothing is pulled from conversations nobody has checked.
   */
  skipped: string | null;
  /** The statements the evaluation blocks, as they were handed to the excerpt call and the steps. */
  blocked: string[];
  at: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_eur: number;
};

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The model's answer (or a stored excerpt) → facts and gaps, capped, duplicates dropped. */
export function normalizePageFactLists(raw: unknown): Pick<ContentPageFacts, "facts" | "gaps"> {
  const r = record(raw);
  const facts: ContentPageFact[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(r.facts) ? r.facts : []) {
    const f = record(item);
    const fact = text(f.fact, FACT_MAX_CHARS);
    const key = fact.toLowerCase();
    if (!fact || seen.has(key)) continue;
    seen.add(key);
    facts.push({ fact, topic: text(f.topic, 80), source: text(f.source, 120), quote: text(f.quote, QUOTE_MAX_CHARS) });
    if (facts.length >= PAGE_FACTS_MAX) break;
  }
  const gaps = (Array.isArray(r.gaps) ? r.gaps : []).map((g) => text(g, 300)).filter(Boolean).slice(0, PAGE_FACTS_GAPS_MAX);
  return { facts, gaps };
}

/** The excerpt as the Analyse's step row holds it (`output.page_facts`); null when there is none yet. */
export function readPageFacts(stepOutput: unknown): ContentPageFacts | null {
  const stored = record(stepOutput).page_facts;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const r = stored as Record<string, unknown>;
  return {
    ...normalizePageFactLists(r),
    conversations: count(r.conversations),
    shortened: r.shortened === true,
    error: text(r.error, 500) || null,
    skipped: text(r.skipped, 500) || null,
    blocked: (Array.isArray(r.blocked) ? r.blocked : []).map((b) => text(b, 1_400)).filter(Boolean).slice(0, 100),
    at: text(r.at, 40),
    model: text(r.model, 120) || null,
    input_tokens: count(r.input_tokens),
    output_tokens: count(r.output_tokens),
    cost_eur: count(r.cost_eur),
  };
}

/** The Analyse's stored output without the excerpt, as the later steps' prompts quote it. */
export function withoutPageFacts(stepOutput: unknown): unknown {
  if (!stepOutput || typeof stepOutput !== "object" || Array.isArray(stepOutput)) return stepOutput;
  const { page_facts: _excerpt, ...rest } = stepOutput as Record<string, unknown>;
  void _excerpt;
  return rest;
}

/**
 * The excerpt inside the Anbieterfakten block. The heading says what it is: confirmed facts
 * like the sections above, chosen for this page. Empty without facts.
 */
export function pageFactsBlock(pageFacts: Pick<ContentPageFacts, "facts"> | null | undefined): string {
  const facts = pageFacts?.facts ?? [];
  if (facts.length === 0) return "";
  const lines = facts.map((f, i) => {
    const topic = f.topic ? `[${f.topic}] ` : "";
    const source = f.source ? ` (${f.source})` : "";
    const quote = f.quote ? ` – Wortlaut: „${f.quote}“` : "";
    return `${i + 1}. ${topic}${f.fact}${source}${quote}`;
  });
  return [
    "### Faktenauszug für diese Seite (aus den Kundengesprächen)",
    "Das haben die Kundengespräche zum Thema genau dieser Seite ergeben. Es sind Anbieterfakten wie die Abschnitte oben, nur für diese Seite ausgewählt und ausführlicher. Der Text dieser Seite soll auf diesen Fakten aufbauen und so viele davon verwenden, wie zur Seite passen.",
    ...lines,
  ].join("\n");
}

/** „18 Fakten aus 3 Gesprächen“ for the page window. */
export function pageFactsSummary(pageFacts: ContentPageFacts): string {
  if (pageFacts.error) return "Faktenauszug fehlgeschlagen";
  if (pageFacts.skipped) return "Kein Faktenauszug: Anbieter-Auswertung nicht freigegeben";
  if (pageFacts.conversations === 0) return "Kein Faktenauszug: keine Gespräche hochgeladen";
  const n = pageFacts.facts.length;
  const c = pageFacts.conversations;
  return `${n} ${n === 1 ? "Fakt" : "Fakten"} aus ${c} ${c === 1 ? "Gespräch" : "Gesprächen"}`;
}
