/**
 * The call that makes a page's „Faktenauszug“ (`page-facts-model.ts`): it reads every
 * conversation of the organisation (summary and wording, in conversation order) next to the
 * page's briefing, the chosen avatar and the approved Anbieter evaluation (which goes first, with
 * its blocked statements as their own block), and returns what was said about this page's topic.
 * Runs once per page as the first part of the Analyse step; „Zurücksetzen“ makes a new one.
 */
import type Anthropic from "@anthropic-ai/sdk";

import { blockedBlock, extractBlockedStatements, type BlockedStatement } from "@/lib/dt/content/pipeline/blocked";
import {
  PAGE_FACTS_GAPS_MAX,
  PAGE_FACTS_MAX,
  normalizePageFactLists,
  type ContentPageFacts,
} from "@/lib/dt/content/pipeline/page-facts-model";
import { avatarBlock, joinPromptParts, pageBlock, type ContentPipelineContext } from "@/lib/dt/content/pipeline/prompts";
import { buildCorpusPrompt, type WorkshopSectionStatus, type WorkshopSource } from "@/lib/dt/transcripts/workshop-model";

export const PAGE_FACTS_USAGE_MODE = "content.facts";
/** Up to 60 facts with their wording: about 6,000 tokens; 8,000 leaves room. */
export const PAGE_FACTS_MAX_TOKENS = 8_000;
/**
 * How much of the conversations one call reads: about 130,000 tokens, which fits a 200,000
 * token context with the briefing and the answer. Longer corpora keep every summary whole and
 * shorten the wording of each conversation evenly.
 */
export const PAGE_FACTS_CORPUS_MAX_CHARS = 400_000;

export const PAGE_FACTS_SYSTEM = `Du bereitest für einen Texter den Faktenauszug für genau eine Seite einer Website vor. Sprache: Deutsch.
Du ziehst Fakten aus den Kundengesprächen des Anbieters (Workshops, als Zusammenfassung und im Wortlaut). Die Seite, ihr Thema, ihre Keywords und Fragen und der Avatar (Wunschkunde) sagen dir, wonach du suchst. Die freigegebene Anbieter-Auswertung liegt bei: Sie ist der geprüfte Stand und geht den Gesprächen vor.
Ziehe alles heraus, was zum Thema dieser Seite gesagt wurde und was ein Texter für einen tiefen, konkreten Text braucht: Leistungen und was dazugehört, Abläufe und Dauern, Zahlen, Preise und Bedingungen, Beispiele und Fälle, typische Probleme und Einwände der Kunden, Abgrenzungen, Besonderheiten, Formulierungen und Begriffe des Anbieters. Dazu, was der Anbieter über genau die Zielgruppe des Avatars gesagt hat.
Regeln:
- Nichts erfinden und nichts aus Branchenwissen ergänzen. Jede Angabe so genau wie im Gespräch: Zahlen, Namen, Fristen und Bedingungen unverändert.
- Lieber vollständig als knapp: höchstens ${PAGE_FACTS_MAX} Fakten, die wichtigsten für diese Seite zuerst. Ein Fakt ist ein bis drei Sätze und für sich verständlich.
- Die Anbieter-Auswertung (vorrangig) geht den Gesprächen vor. Was sie festhält, gilt so, wie es dort steht.
- Ein Fakt aus einem Gespräch, der der Anbieter-Auswertung widerspricht, entfällt. Du ziehst ihn nicht und gleichst ihn nicht an.
- Was im Block „Gesperrt“ steht oder in der Anbieter-Auswertung mit „nicht verwenden“, „noch nicht verwenden“, „nicht für Content verwenden“, „nicht nennen“, „nicht aktiv bewerben“, „Freigabe offen“, „Freigabe … noch offen“ oder „nur erwähnen, wenn“ markiert ist, ziehst du nicht, auch nicht sinngemäß und auch nicht in Teilen (kein Name, keine Zahl, kein Beispiel daraus), selbst wenn ein Gespräch es ausführlich schildert.
- Widersprechen sich zwei Gespräche, gilt das spätere; nenne nur den späteren Stand.
- Was nur andere Seiten der Website betrifft, lässt du weg. Allgemeines über das Unternehmen nur, wenn diese Seite es braucht.
- source nennt das Gespräch so, wie es überschrieben ist („Gespräch 2“). quote ist der Wortlaut des Sprechers, wenn er sich als Formulierung lohnt, sonst leer.
- gaps: höchstens ${PAGE_FACTS_GAPS_MAX} Angaben, die diese Seite bräuchte, die aber in keinem Gespräch vorkommen.
Steht in den Gesprächen nichts zum Thema der Seite, gibst du eine leere Liste zurück.`;

export const PAGE_FACTS_TOOL: Anthropic.Tool = {
  name: "submit_page_facts",
  description: `Der Faktenauszug für diese Seite: höchstens ${PAGE_FACTS_MAX} Fakten aus den Kundengesprächen, die wichtigsten zuerst.`,
  input_schema: {
    type: "object",
    properties: {
      facts: {
        type: "array",
        maxItems: PAGE_FACTS_MAX,
        items: {
          type: "object",
          properties: {
            fact: { type: "string", description: "Die Angabe in ein bis drei Sätzen, so genau wie im Gespräch." },
            topic: { type: "string", description: "Unterthema in 1–3 Wörtern, z. B. Ablauf, Preis, Einwand, Beispiel." },
            source: { type: "string", description: "Das Gespräch, z. B. „Gespräch 2“." },
            quote: { type: "string", description: "Wortlaut des Sprechers, wenn er sich lohnt; sonst leer." },
          },
          required: ["fact", "topic", "source", "quote"],
        },
      },
      gaps: { type: "array", maxItems: PAGE_FACTS_GAPS_MAX, items: { type: "string" } },
    },
    required: ["facts", "gaps"],
  },
};

/** The conversations for the prompt, shortened evenly when they are longer than one call reads. */
export function pageFactsCorpus(sources: WorkshopSource[], maxChars: number = PAGE_FACTS_CORPUS_MAX_CHARS): { text: string; shortened: boolean } {
  const whole = buildCorpusPrompt(sources);
  if (whole.length <= maxChars) return { text: whole, shortened: false };
  // The summaries stay; what is left of the budget is shared by the wordings.
  const fixed = buildCorpusPrompt(sources, { rawChars: 0 }).length;
  const perSource = Math.max(2_000, Math.floor((maxChars - fixed) / Math.max(1, sources.length)));
  return { text: buildCorpusPrompt(sources, { rawChars: perSource }), shortened: true };
}

/** The approved evaluation as the excerpt call reads it: every filled point, whole. */
export function evaluationBlock(evaluation: ReadonlyArray<{ label: string; current: string }>): string {
  const filled = evaluation.filter((item) => item.current.trim());
  if (filled.length === 0) return "";
  return [
    "## Anbieter-Auswertung (vorrangig)",
    "Der freigegebene Stand des Anbieters. Er geht den Gesprächen vor; die Vermerke darin gelten.",
    ...filled.map((item) => `### ${item.label}\n${item.current.trim()}`),
  ].join("\n\n");
}

export function pageFactsPrompt(
  context: ContentPipelineContext,
  sources: WorkshopSource[],
  /** The approved Anbieter evaluation (`dt_workshop_corpus.anbieter.items`). */
  evaluation: ReadonlyArray<{ label: string; current: string }> = [],
): { system: string; user: string; tool: Anthropic.Tool; maxTokens: number; shortened: boolean; blocked: BlockedStatement[] } {
  const corpus = pageFactsCorpus(sources);
  const blocked = extractBlockedStatements(evaluation);
  return {
    blocked,
    system: PAGE_FACTS_SYSTEM,
    user: joinPromptParts([
      pageBlock(context),
      avatarBlock(context),
      evaluationBlock(evaluation),
      blockedBlock(blocked, "##"),
      `## Kundengespräche (frühere zuerst, das spätere gilt bei Widerspruch)\n${corpus.text}`,
    ]),
    tool: PAGE_FACTS_TOOL,
    maxTokens: PAGE_FACTS_MAX_TOKENS,
    shortened: corpus.shortened,
  };
}

/** The blocked statements as the page window lists them. */
export function blockedLines(blocked: readonly BlockedStatement[]): string[] {
  return blocked.map((b) => `[${b.section}] ${b.text}`);
}

/**
 * Why no excerpt is made for this state of the evaluation, in German for the page window; null
 * when it is approved and current. Without an approved evaluation nobody has checked what the
 * conversations say, and there are no release notes to keep to.
 */
export function evaluationSkipReason(status: WorkshopSectionStatus): string | null {
  switch (status) {
    case "approved":
      return null;
    case "stale":
      return "Seit der letzten Anbieter-Auswertung wurde ein Gespräch hochgeladen oder geändert. Bitte unter Transkripte „Anbieter auswerten“ neu laufen lassen und freigeben, dann die Seite zurücksetzen.";
    case "proposed":
      return "Die Anbieter-Auswertung ist noch nicht freigegeben. Bitte unter Transkripte freigeben, dann die Seite zurücksetzen.";
    default:
      return "Es gibt noch keine Anbieter-Auswertung der Gespräche. Bitte unter Transkripte „Anbieter auswerten“ laufen lassen und freigeben, dann die Seite zurücksetzen.";
  }
}

/** The stored excerpt of a finished call. */
export function pageFactsFromCall(input: {
  json: unknown;
  conversations: number;
  shortened: boolean;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  costEur: number;
  blocked?: readonly BlockedStatement[];
  now?: Date;
}): ContentPageFacts {
  return {
    ...normalizePageFactLists(input.json),
    conversations: input.conversations,
    shortened: input.shortened,
    error: null,
    skipped: null,
    blocked: blockedLines(input.blocked ?? []),
    at: (input.now ?? new Date()).toISOString(),
    model: input.model,
    input_tokens: input.usage.inputTokens,
    output_tokens: input.usage.outputTokens,
    cost_eur: input.costEur,
  };
}

/** No call was made (no conversations) or it failed: the page runs as before, the reason is kept. */
export function emptyPageFacts(input: {
  conversations: number;
  error?: string | null;
  skipped?: string | null;
  blocked?: readonly BlockedStatement[];
  now?: Date;
}): ContentPageFacts {
  return {
    facts: [],
    gaps: [],
    conversations: input.conversations,
    shortened: false,
    error: input.error?.trim().slice(0, 500) || null,
    skipped: input.skipped?.trim().slice(0, 500) || null,
    blocked: blockedLines(input.blocked ?? []),
    at: (input.now ?? new Date()).toISOString(),
    model: null,
    input_tokens: 0,
    output_tokens: 0,
    cost_eur: 0,
  };
}
