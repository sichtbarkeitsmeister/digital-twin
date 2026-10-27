/**
 * The Aktualitätsprüfung (after GEO): every time-sensitive statement of the page text is
 * checked with Anthropic's web search, in two calls.
 *
 *   1. Research (`aktualitaetResearchPrompt`): web search and web fetch, tool_choice auto. The
 *      model writes a protocol; the code collects every URL the search or fetch returned
 *      (`inspectResearchBlocks`).
 *   2. Result (`aktualitaetWriteSpec`): a tool-forced call through `callContentTool` with the
 *      protocol and that URL list, without web tools. It returns the text, the changes with
 *      their source, questions for the customer and outdated Abschnitte.
 *
 * The model's answer is a proposal. `normalizeAktualitaetOutput` enforces the rules in code:
 * a change counts only with a source from the research; only the Abschnitte a valid change
 * names may differ from the input; H1, hero, question headings, keywords and markers stay;
 * a customer fact is never changed (it becomes a question). Pure: no Supabase, no Anthropic
 * client; `run-step.ts` wires it to the model.
 */

import type Anthropic from "@anthropic-ai/sdk";

import { contentTextKey, type AktualitaetResearch } from "@/lib/dt/content/freshness";
import { CONTENT_PAGE_TYPE_LABELS } from "@/lib/dt/content/page-types";
import { contentSectionName } from "@/lib/dt/content/pipeline/gaps";
import {
  BLOCKS_SCHEMA,
  CONTENT_HERO_BLOCK_ID,
  TEXT_PROPERTIES,
  anbieterBlock,
  currentTextBlock,
  joinPromptParts,
  normalizeQuestions,
  notesBlock,
  pageBlock,
  settingsBlock,
  stepInstruction,
  stepSystem,
  type AnalyseOutput,
  type ContentPipelineContext,
  type ContentStepSpec,
  type TextOutput,
} from "@/lib/dt/content/pipeline/prompts";
import { CONTENT_STEP_ANALYSE } from "@/lib/dt/content/pipeline/steps";
import { blocksToPromptText, escapeHtml, normalizeBlocks, type ContentTextBlock } from "@/lib/dt/content/render";
import type {
  ContentFinding,
  ContentFreshnessSection,
  ContentFreshnessSource,
  ContentFreshnessUpdate,
  ContentQuestion,
} from "@/lib/dt/content/types";
import { DT_WEB_RESEARCH_INSTRUCTIONS, inspectWebResearchBlocks } from "@/lib/dt/seo/web-research";

/** Output budget of the result call: the whole text plus the lists, a little more than GEO. */
export const AKTUALITAET_MAX_TOKENS = 16_000;
/** Output budget of the research call: the protocol only, the search results are input. */
export const AKTUALITAET_RESEARCH_MAX_TOKENS = 8_000;
/** How much of the research protocol the result call reads. */
const MAX_PROTOCOL_CHARS = 16_000;
/** Longer passages are no „smallest possible change“: an outdated Abschnitt goes back to GEO instead. */
const MAX_CHANGE_CHARS = 600;
const MAX_UPDATES = 30;
const MAX_SECTIONS = 10;
const MAX_CHECKED = 60;

export const AKTUALITAET_STATUSES = ["aktuell", "aktualisiert", "frage", "abschnitt_veraltet"] as const;
export type AktualitaetStatus = (typeof AKTUALITAET_STATUSES)[number];

export type AktualitaetCheck = {
  block_id: string | null;
  claim: string;
  status: AktualitaetStatus;
  /** Only a URL from the research; null otherwise. */
  source_url: string | null;
};

export type AktualitaetUpdate = Omit<ContentFreshnessUpdate, "at">;

/** The normalised result of the step, stored in its row; the text goes on the page. */
export type AktualitaetOutput = TextOutput & {
  checked: AktualitaetCheck[];
  /** Changes that passed every rule; they are in `blocks` (or title / meta description). */
  updates: AktualitaetUpdate[];
  /**
   * For the customer, each backed by a source from the research: the model's questions with
   * one, and every customer fact it tried to change. They stop the page as „Braucht Sie“.
   */
  questions: ContentQuestion[];
  /**
   * The model's questions without such a source („Stimmen die Öffnungszeiten noch?“): kept in
   * the step's record, never asked. Without a hint that a fact changed, the Faktencheck's
   * check against the Anbieterfakten stands.
   */
  unasked_questions: ContentQuestion[];
  /** Outdated Abschnitte with at least one source from the research. */
  outdated_sections: ContentFreshnessSection[];
  /** Rejected changes and other open points of this check. */
  findings: ContentFinding[];
  /** What the web research did (counts only; the protocol stays in the step's progress). */
  research: { searches: number; fetches: number; sources: number; claims: number | null; search_limit_hit: boolean };
};

// --- fixed rules and prompts ----------------------------------------------------------------------

/**
 * Locked rules of the step, added after the editable instruction (Globale Prompts →
 * Aktualitätsprüfung). The code enforces the same rules on the answer.
 */
export const AKTUALITAET_RULES = `Feste Regeln der Aktualitätsprüfung:
- Abweichend von der Regel oben dürfen in diesem Schritt öffentliche Fakten (Gesetze, Fristen, Förderungen, Normen, Statistiken, Technikstände, Vorgaben von Google und KI-Anbietern) mit einer Quelle aus der Websuche aktualisiert werden. Alles über den Kunden kommt weiter nur aus den Anbieterfakten und den Anmerkungen der Redaktion.
- Kundenangaben ändert dieser Schritt nie: Preise, Leistungen, Team, Öffnungszeiten, Referenzen, Gründungsjahr und alles, was aus den Anbieterfakten stammt. Zeigt eine Quelle aus der Websuche, dass eine davon nicht mehr stimmt, wird daraus eine Frage an den Kunden mit dieser Quelle (source_url). Ohne solchen Hinweis gibt es keine Frage: keine Routinefragen („Stimmt das noch?“, „Hat sich das Team verändert?“), keine Vorschläge für zusätzliche Inhalte, keine Fragen zur Schreibweise.
- Als Quelle zählen nur URLs, die die Websuche oder der Web-Abruf in diesem Schritt geliefert hat. Bevorzugt: Gesetzestexte, Behörden und Ministerien, Kammern und Verbände, Normungsstellen, Hersteller. Foren, unbekannte Blogs, Vergleichs- und Ratgeberportale ohne Impressum und KI-generierte Seiten zählen nicht. Eine Änderung ohne gültige Quelle wird verworfen.
- Kleinste mögliche Änderung: eine Zahl, ein Datum, ein Name, ein Halbsatz. Ist ein ganzer Abschnitt überholt, meldest du ihn als veraltet; er geht dann einmal an GEO zurück.
- Nur Abschnitte, die eine Änderung nennt, dürfen sich ändern; jeder andere Abschnitt bleibt wörtlich, wie er ist.
- Unverändert bleiben: die H1, der Abschnitt „hero“ mit seinem Platzhalter, Frage-Überschriften (bleiben Fragen), Haupt- und Nebenkeywords, [BITTE PRÜFEN: …], [QUELLE BITTE ERGÄNZEN], [LINK: …], [DATUM] und die ids der Abschnitte.
- Quellen stehen nie im Seitentext: keine URL, kein Link, keine Quellenangabe im Text. Die Quelle gehört nur in source_url.
- Suchanfragen enthalten nie den Firmennamen, Namen von Personen oder andere Angaben aus Anbieterfakten, Avatar oder Anmerkungen; gesucht wird nur nach dem öffentlichen Sachverhalt.`;

function todayText(now: Date): string {
  return now.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Same system prompt for both calls, so the instruction and the rules never differ between them. */
export function aktualitaetSystemPrompt(context: ContentPipelineContext): string {
  return stepSystem(stepInstruction(context, "aktualitaet"), context.settings, [AKTUALITAET_RULES, DT_WEB_RESEARCH_INSTRUCTIONS]);
}

/** Fingerprint of the text the research looks at; another text means the research is stale. */
export function aktualitaetTextKey(context: Pick<ContentPipelineContext, "blocks" | "title" | "metaDescription">): string {
  return contentTextKey([blocksToPromptText(context.blocks), context.title, context.metaDescription]);
}

/** Line of the protocol that says how many statements were found (`parseClaimCount`). */
const CLAIMS_LINE = "Zeitkritische Aussagen";

/**
 * The research call: the text and what the page is about, nothing internal (no Anbieterfakten,
 * no avatar, no notes), so nothing of it can slip into a search query.
 */
export function aktualitaetResearchPrompt(
  context: ContentPipelineContext,
  now: Date = new Date(),
): { system: string; user: string; maxTokens: number } {
  const { page } = context;
  return {
    system: aktualitaetSystemPrompt(context),
    maxTokens: AKTUALITAET_RESEARCH_MAX_TOKENS,
    user: joinPromptParts([
      [
        "## Seite",
        `Seite: ${page.name}`,
        `Seitentyp: ${CONTENT_PAGE_TYPE_LABELS[page.page_type]}`,
        `Branche: ${context.settings.branche || "nicht angegeben"}`,
      ].join("\n"),
      `## Heute\n${todayText(now)}`,
      currentTextBlock(context),
      [
        "## Auftrag in diesem Aufruf: Recherche",
        "Finde alle zeitkritischen Aussagen des Texts und prüfe sie mit web_search und, wo nötig, web_fetch. Den Text änderst du in diesem Aufruf nicht.",
        "Schreibe danach ein Prüfprotokoll, eine Zeile je Aussage:",
        "- [id des Abschnitts] „Aussage, wörtlich“ → aktuell | veraltet | Kundenangabe | ganzer Abschnitt veraltet | nicht prüfbar – heutiger Stand in einem Satz – Quelle: URL",
        "Kundenangaben (Preise, Leistungen, Team, Öffnungszeiten, Referenzen) suchst du nicht; du markierst sie nur als Kundenangabe.",
        `Zum Schluss eine eigene Zeile „${CLAIMS_LINE}: N“ mit der Zahl der Zeilen (0, wenn der Text keine zeitkritische Aussage enthält).`,
      ].join("\n"),
    ]),
  };
}

export const AKTUALITAET_TOOL: Anthropic.Tool = {
  name: "submit_aktualitaet",
  description:
    "Ergebnis der Aktualitätsprüfung: der vollständige Text (geändert nur an belegten Stellen), jede geprüfte Aussage, die Änderungen mit Quelle, Fragen an den Kunden und veraltete Abschnitte.",
  input_schema: {
    type: "object",
    properties: {
      ...TEXT_PROPERTIES,
      blocks: {
        ...BLOCKS_SCHEMA,
        description:
          "Der komplette Text mit allen Abschnitten in der bisherigen Reihenfolge und mit den bisherigen ids. Nur Abschnitte, die in updates stehen, dürfen sich ändern, und nur an der genannten Stelle.",
      },
      checked: {
        type: "array",
        description: "Jede zeitkritische Aussage des Texts mit ihrer Einstufung.",
        items: {
          type: "object",
          properties: {
            block_id: { type: "string", description: "id des Abschnitts." },
            claim: { type: "string", description: "Die Aussage, wörtlich oder knapp." },
            status: { type: "string", enum: [...AKTUALITAET_STATUSES] },
            source_url: { type: "string", description: "URL aus „Erlaubte Quellen“, die die Einstufung belegt; leer, wenn keine." },
          },
          required: ["block_id", "claim", "status", "source_url"],
        },
      },
      updates: {
        type: "array",
        description: "Jede Änderung am Text. Ohne Quelle aus „Erlaubte Quellen“ keine Änderung.",
        items: {
          type: "object",
          properties: {
            block_id: { type: "string", description: "id des Abschnitts; „title“ oder „meta_description“ für Title-Tag und Meta-Description." },
            old_text: { type: "string", description: "Die Stelle wörtlich aus dem aktuellen Text, so kurz wie möglich." },
            new_text: { type: "string", description: "Der Ersatz für genau diese Stelle, ohne Quelle und ohne URL." },
            reason: { type: "string", description: "Was sich geändert hat, in einem Satz." },
            source_url: { type: "string", description: "URL aus „Erlaubte Quellen“." },
            source_title: { type: "string", description: "Titel der Quelle." },
          },
          required: ["block_id", "old_text", "new_text", "reason", "source_url", "source_title"],
        },
      },
      questions: {
        type: "array",
        description: "Fragen an den Kunden: nur Angaben über ihn, die laut einer Quelle aus „Erlaubte Quellen“ nicht mehr stimmen (kind „outdated“). Keine Routinefragen ohne Hinweis.",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["outdated", "fact"] },
            question: { type: "string" },
            block_id: { type: "string" },
            excerpt: { type: "string", description: "Der Satz aus dem Text, um den es geht." },
            placeholder: { type: "string", description: "Was die Websuche dazu nahelegt, oder leer." },
            source_url: { type: "string", description: "URL aus „Erlaubte Quellen“, die zeigt, dass die Angabe nicht mehr stimmt. Ohne solche Quelle keine Frage." },
          },
          required: ["kind", "question", "block_id", "excerpt", "placeholder", "source_url"],
        },
      },
      outdated_sections: {
        type: "array",
        description: "Ganze Abschnitte, die überholt sind und nicht mit einer kleinen Änderung zu retten sind.",
        items: {
          type: "object",
          properties: {
            block_id: { type: "string" },
            problem: { type: "string", description: "Was genau veraltet ist." },
            suggestion: { type: "string", description: "Was stattdessen im Abschnitt stehen sollte." },
            sources: {
              type: "array",
              items: {
                type: "object",
                properties: { url: { type: "string" }, title: { type: "string" } },
                required: ["url", "title"],
              },
            },
          },
          required: ["block_id", "problem", "suggestion", "sources"],
        },
      },
    },
    required: ["title", "meta_description", "blocks", "checked", "updates", "questions", "outdated_sections"],
  },
};

function sourcesBlock(sources: readonly ContentFreshnessSource[]): string {
  if (sources.length === 0) return "## Erlaubte Quellen\n(keine – die Websuche hat nichts geliefert; dann gibt es keine Änderung)";
  return [
    "## Erlaubte Quellen (nur diese URLs dürfen als source_url stehen)",
    ...sources.map((s) => `- ${s.title ? `${s.title} – ` : ""}${s.url}`),
  ].join("\n");
}

/** The result call: the research protocol, the allowed sources and everything a step normally reads. */
export function aktualitaetWriteSpec(
  context: ContentPipelineContext,
  research: AktualitaetResearch,
  now: Date = new Date(),
): ContentStepSpec {
  const protocol = research.text.trim();
  return {
    maxTokens: AKTUALITAET_MAX_TOKENS,
    system: aktualitaetSystemPrompt(context),
    user: joinPromptParts([
      pageBlock(context),
      `## Heute\n${todayText(now)}`,
      currentTextBlock(context),
      `## Prüfprotokoll der Websuche (Recherche dieses Schritts)\n${protocol ? protocol.slice(0, MAX_PROTOCOL_CHARS) : "(leer)"}`,
      sourcesBlock(research.sources),
      anbieterBlock(context),
      settingsBlock(context.settings),
      notesBlock(context),
      [
        "## Auftrag in diesem Aufruf: Ergebnis",
        `Die Recherche ist abgeschlossen; in diesem Aufruf gibt es keine Websuche. Rufe ${AKTUALITAET_TOOL.name} genau einmal auf:`,
        "- blocks: der vollständige Text mit allen Abschnitten und ids, geändert nur an den Stellen aus updates.",
        "- checked: jede zeitkritische Aussage mit Einstufung (aktuell, aktualisiert, frage, abschnitt_veraltet) und der belegenden URL.",
        "- updates: jede Änderung mit block_id, old_text (wörtlich), new_text, reason, source_url (aus „Erlaubte Quellen“) und source_title.",
        "- questions: nur Kundenangaben, die laut einer Quelle aus „Erlaubte Quellen“ nicht mehr stimmen, als Frage an den Kunden (kind „outdated“), mit source_url, block_id und dem Satz. Keine Routinefragen ohne solchen Hinweis, keine Vorschläge, keine Fragen zur Schreibweise.",
        "- outdated_sections: ganze Abschnitte, die überholt sind, mit Problem, Vorschlag und Quellen aus „Erlaubte Quellen“.",
        "Title und Meta-Description bleiben, außer eine Änderung betrifft sie.",
      ].join("\n"),
    ]),
    tool: AKTUALITAET_TOOL,
    normalize: (json, ctx) => normalizeAktualitaetOutput(json, ctx, research),
  };
}

// --- what the research returned -------------------------------------------------------------------

/** Same URL for the rules: scheme, „www.“, fragment and a trailing slash do not count. Null for anything that is not http(s). */
export function normalizeSourceUrl(raw: string): string | null {
  let trimmed = raw.trim().replace(/[)\]>.,;:!?"'“”]+$/, "");
  if (!trimmed) return null;
  // The model sometimes drops the scheme („kfw.de/…“); a bare host still names the same page.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(trimmed)) trimmed = `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${path}${url.search}`;
}

export type ResearchInspection = {
  /** Every URL the search, the fetch or a citation returned, first title wins. */
  sources: ContentFreshnessSource[];
  /** Successful search results and fetched pages. */
  searchResults: number;
  fetchResults: number;
  /** `error_code` of every failed search / fetch. */
  searchErrors: string[];
  fetchErrors: string[];
  searchLimitHit: boolean;
};

type LooseBlock = { type?: string; content?: unknown; citations?: unknown };

/**
 * The URLs the web search and fetch actually returned, across all rounds: search result
 * items, fetched documents and citations. This is the closed list an update may cite.
 */
export function inspectResearchBlocks(blocks: readonly unknown[]): ResearchInspection {
  const found = new Map<string, ContentFreshnessSource>();
  const add = (url: unknown, title: unknown) => {
    if (typeof url !== "string") return;
    const key = normalizeSourceUrl(url);
    if (!key) return;
    const existing = found.get(key);
    const clean = typeof title === "string" && title.trim() ? title.trim().slice(0, 300) : null;
    if (!existing) found.set(key, { url: url.trim(), title: clean });
    else if (!existing.title && clean) existing.title = clean;
  };
  let searchResults = 0;
  let fetchResults = 0;
  const searchErrors: string[] = [];
  const fetchErrors: string[] = [];

  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as LooseBlock;
    if (block.type === "web_search_tool_result") {
      if (Array.isArray(block.content)) {
        for (const item of block.content as Array<{ type?: string; url?: unknown; title?: unknown }>) {
          if (item?.type !== "web_search_result") continue;
          searchResults += 1;
          add(item.url, item.title);
        }
      } else {
        const error = block.content as { error_code?: unknown } | undefined;
        searchErrors.push(typeof error?.error_code === "string" ? error.error_code : "unknown");
      }
    } else if (block.type === "web_fetch_tool_result") {
      const content = block.content as { type?: string; url?: unknown; error_code?: unknown; content?: { title?: unknown } } | undefined;
      if (content?.type === "web_fetch_result") {
        fetchResults += 1;
        add(content.url, content.content?.title);
      } else {
        fetchErrors.push(typeof content?.error_code === "string" ? content.error_code : "unknown");
      }
    } else if (block.type === "text" && Array.isArray(block.citations)) {
      for (const citation of block.citations as Array<{ type?: string; url?: unknown; title?: unknown }>) {
        if (citation?.type === "web_search_result_location") add(citation.url, citation.title);
      }
    }
  }
  return {
    sources: [...found.values()],
    searchResults,
    fetchResults,
    searchErrors,
    fetchErrors,
    searchLimitHit: inspectWebResearchBlocks([...blocks]).searchLimitHit,
  };
}

/** „Zeitkritische Aussagen: N“ (the last one counts); null when the protocol has no such line. */
export function parseClaimCount(protocol: string): number | null {
  const matches = [...protocol.matchAll(/zeitkritische\s+aussagen\s*:\s*\**\s*(\d+)/giu)];
  const last = matches[matches.length - 1];
  return last ? Number(last[1]) : null;
}

export function researchFromCall(
  protocol: string,
  inspection: ResearchInspection,
  usage: { searches: number; fetches: number },
): AktualitaetResearch {
  return {
    text: protocol.trim(),
    sources: inspection.sources,
    searches: usage.searches,
    fetches: usage.fetches,
    search_limit_hit: inspection.searchLimitHit,
    claims: parseClaimCount(protocol),
  };
}

const TRANSIENT_SEARCH_ERRORS = new Set(["too_many_requests", "unavailable"]);

/**
 * Whether the research can stand. Without a single source the step must never pass the text
 * as „aktuell“: the only exception is a protocol that found no time-sensitive statement at
 * all and a search that did not fail. Null when the research is usable.
 */
export function researchProblem(
  research: AktualitaetResearch,
  inspection: Pick<ResearchInspection, "searchErrors" | "fetchErrors">,
): { message: string; retryable: boolean } | null {
  if (research.sources.length > 0) return null;
  const errors = [...inspection.searchErrors, ...inspection.fetchErrors];
  if (research.claims === 0 && errors.length === 0) return null;
  if (errors.length > 0) {
    const codes = [...new Set(errors)].join(", ");
    return {
      message: `Die Websuche der Aktualitätsprüfung hat nur Fehler geliefert (${codes}). Ohne Quelle wird nichts als „aktuell“ durchgelassen. Mit „Weiterlaufen lassen“ erneut versuchen; bleibt es dabei, die Websuche für den Texte-Schlüssel in der Anthropic Console prüfen.`,
      retryable: errors.some((code) => TRANSIENT_SEARCH_ERRORS.has(code)),
    };
  }
  return {
    message:
      "Die Aktualitätsprüfung hat keine Websuche ausgeführt und keine Quelle gefunden. Ohne Quelle wird nichts als „aktuell“ durchgelassen. Der Schritt wird erneut versucht.",
    retryable: true,
  };
}

// --- normalisation: the rules in code --------------------------------------------------------------

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, max = 2_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** Inline text of a block for comparisons: inline tags vanish, block tags become a space. */
function inlineText(html: string): string {
  return html
    .replace(/<\/?(?:strong|em|b|i|a|span)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function blockText(block: Pick<ContentTextBlock, "heading" | "html">): string {
  return `${block.heading ?? ""} ${inlineText(block.html)}`.replace(/\s+/g, " ").trim();
}

/** How the model may quote: Markdown emphasis and surrounding quotes do not belong to the text. */
function cleanQuote(text: string): string {
  return text
    .replace(/\*\*|__/g, "")
    .replace(/^[\s„“"']+|[\s„“"']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const URL_IN_TEXT_RE = /https?:\/\/|www\.[a-z0-9-]+\./i;
/** Markers that must survive any change: placeholders, link markers, the date line, the hero placeholder. */
const MARKER_RE = /\[\s*(?:BITTE\s+PR(?:Ü|UE)FEN|QUELLE\s+BITTE|PREIS\s+BITTE|LINK\s*:|DATUM|FOTO\s*:|HERO)[^\]]*\]/giu;

function markersOf(block: Pick<ContentTextBlock, "heading" | "html">): string {
  return [...blockText(block).matchAll(MARKER_RE)]
    .map((m) => m[0].replace(/\s+/g, " "))
    .sort()
    .join("|");
}

/** Index of `needle` in `html` outside any tag, or -1. */
function indexOutsideTags(html: string, needle: string): number {
  let from = 0;
  while (from <= html.length) {
    const at = html.indexOf(needle, from);
    if (at < 0) return -1;
    const open = html.lastIndexOf("<", at);
    const close = html.lastIndexOf(">", at);
    if (open <= close) return at;
    from = at + 1;
  }
  return -1;
}

/** The change applied to the stored block itself, so nothing else in it can move. Null when the passage is not there verbatim. */
function replaceInBlock(block: ContentTextBlock, oldText: string, newText: string): ContentTextBlock | null {
  for (const candidate of [oldText, escapeHtml(oldText)]) {
    const at = indexOutsideTags(block.html, candidate);
    if (at >= 0) {
      return { ...block, html: `${block.html.slice(0, at)}${escapeHtml(newText)}${block.html.slice(at + candidate.length)}` };
    }
  }
  const heading = block.heading ?? "";
  const inHeading = heading.indexOf(oldText);
  if (inHeading >= 0) {
    return { ...block, heading: `${heading.slice(0, inHeading)}${newText}${heading.slice(inHeading + oldText.length)}` };
  }
  return null;
}

/**
 * The model's own version of a block counts only when undoing its declared changes gives the
 * stored block back exactly: then nothing else in it was rewritten.
 */
function onlyDeclaredChanges(
  model: ContentTextBlock,
  input: ContentTextBlock,
  changes: readonly { old_text: string; new_text: string }[],
): boolean {
  let text = blockText(model);
  for (const change of changes) {
    const added = cleanQuote(change.new_text);
    const at = text.indexOf(added);
    if (!added || at < 0) return false;
    text = `${text.slice(0, at)}${cleanQuote(change.old_text)}${text.slice(at + added.length)}`;
  }
  return text.replace(/\s+/g, " ").trim() === blockText(input);
}

/** The text's keywords: from the briefing and from the Analyse. */
function pageKeywords(context: ContentPipelineContext): string[] {
  const analyse = context.outputs[CONTENT_STEP_ANALYSE] as Partial<AnalyseOutput> | undefined;
  const all = [
    context.page.keywords?.main.text,
    ...(context.page.keywords?.secondary.map((k) => k.text) ?? []),
    analyse?.main_keyword,
    ...(Array.isArray(analyse?.secondary_keywords) ? analyse.secondary_keywords : []),
  ];
  return [...new Set(all.map((k) => (typeof k === "string" ? k.trim().toLowerCase() : "")).filter((k) => k.length >= 3))];
}

/** Why a changed block breaks the fixed rules, or null. */
function brokenRule(before: ContentTextBlock, after: ContentTextBlock, keywords: readonly string[]): string | null {
  if (markersOf(before) !== markersOf(after)) return "Ein Platzhalter oder Marker ([BITTE PRÜFEN: …], [LINK: …], [DATUM] …) wäre verloren gegangen oder verändert worden.";
  const heading = before.heading?.trim() ?? "";
  if (heading.endsWith("?") && (after.heading?.trim() ?? "") !== heading) return "Eine Frage-Überschrift bleibt unverändert.";
  const was = blockText(before).toLowerCase();
  const now = blockText(after).toLowerCase();
  const lost = keywords.find((k) => was.includes(k) && !now.includes(k));
  if (lost) return `Das Keyword „${lost}“ wäre aus dem Abschnitt verschwunden.`;
  return null;
}

// Customer facts: what only the customer can confirm. Deliberately broad; a public fact taken
// for a customer fact becomes a question, which is the safe direction.
const CURRENCY_RE = /\d[\d.,]*\s?(?:€|eur\b|euro\b)|€\s?\d/iu;
// `\b` does not see umlauts as letters, hence the lookbehind.
const HOURS_RE =
  /(?<!\p{L})(?:öffnungszeit|oeffnungszeit|sprechzeit|sprechstunde|geöffnet|geoeffnet)\p{L}*|(?<![\p{L}\p{N}])\d{1,2}(?:[:.]\d{2})?\s*(?:–|-|bis)\s*\d{1,2}(?:[:.]\d{2})?\s*uhr(?!\p{L})/iu;
const FIRST_PERSON_RE = /(?:^|[^\p{L}])(?:wir|uns|unser\p{L}*)(?=$|[^\p{L}])/iu;

function looseText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function numberTokens(text: string): string[] {
  return [...text.matchAll(/\d[\d.,]*\d|\d/g)].map((m) => m[0].replace(/[.,]/g, ""));
}

export type CustomerFactContext = {
  organisationName: string;
  /** The Anbieterfakten as one text. */
  facts: string;
};

export function customerFactContext(context: Pick<ContentPipelineContext, "organisationName" | "sections">): CustomerFactContext {
  return { organisationName: context.organisationName, facts: context.sections.map((s) => s.current).join("\n") };
}

/**
 * Why a change touches a fact only the customer can confirm (price, opening hours, the company
 * itself, a passage or number taken from the Anbieterfakten), or null for a public fact.
 * `sentence` is the sentence of the text the passage sits in.
 */
export function customerFactReason(
  change: { old_text: string; new_text: string },
  sentence: string,
  ctx: CustomerFactContext,
): string | null {
  const old = change.old_text;
  const name = ctx.organisationName.trim().toLowerCase();
  const mentionsCompany = (text: string) => FIRST_PERSON_RE.test(text) || (name.length >= 3 && text.toLowerCase().includes(name));
  if (mentionsCompany(old)) return "Angabe über das Unternehmen";
  if (HOURS_RE.test(old)) return "Öffnungs- oder Sprechzeiten";
  const factNumbers = new Set(numberTokens(ctx.facts).filter((n) => n.length >= 3));
  const fromFacts = numberTokens(old).some((n) => n.length >= 3 && factNumbers.has(n));
  if (CURRENCY_RE.test(old) && (mentionsCompany(sentence) || fromFacts)) return "Preis des Kunden";
  if (fromFacts) return "Zahl aus den Anbieterfakten";
  const loose = looseText(old);
  if (loose.length >= 8 && looseText(ctx.facts).includes(loose)) return "Text aus den Anbieterfakten";
  return null;
}

/** The sentence of `text` around `passage` (the whole text when it is not found). */
function sentenceOf(text: string, passage: string): string {
  const at = text.indexOf(passage);
  if (at < 0) return text.slice(0, 400);
  const before = text.slice(0, at);
  const start = Math.max(before.lastIndexOf(". "), before.lastIndexOf("! "), before.lastIndexOf("? ")) + 1;
  const rest = text.slice(at + passage.length);
  const endMatch = rest.match(/[.!?](\s|$)/);
  const end = at + passage.length + (endMatch?.index != null ? endMatch.index + 1 : rest.length);
  return text.slice(start, end).trim().slice(0, 500);
}

type Rejection = "quelle" | "abschnitt" | "geschuetzt" | "url" | "umfang" | "fundstelle" | "regel";

const REJECTION_TITLES: Record<Rejection, string> = {
  quelle: "Quelle fehlt",
  abschnitt: "Abschnitt nicht gefunden",
  geschuetzt: "H1 und Hero bleiben unverändert",
  url: "Quelle gehört nicht in den Text",
  umfang: "Änderung zu umfangreich",
  fundstelle: "Textstelle nicht gefunden",
  regel: "Änderung verletzt feste Regeln",
};

function rejectedChange(
  change: { block_id: string; old_text: string; new_text: string; reason: string; source_url: string },
  why: Rejection,
  blockId: string | null,
  detail = "",
): ContentFinding {
  const what = `„${change.old_text}“ → „${change.new_text}“`;
  const problem =
    why === "quelle"
      ? `Die Aktualitätsprüfung wollte ${what} ändern, die Quelle stammt aber nicht aus der Websuche dieses Schritts${change.source_url ? ` (${change.source_url})` : ""}. Der Text blieb unverändert.`
      : `Die Aktualitätsprüfung wollte ${what} ändern. ${detail || REJECTION_TITLES[why]}. Der Text blieb unverändert.`;
  return {
    title: REJECTION_TITLES[why],
    problem: problem.slice(0, 1_000),
    proposal: `Prüfen und bei Bedarf von Hand ändern: „${change.new_text}“.${change.reason ? ` Grund laut Websuche: ${change.reason}` : ""}${why !== "quelle" && change.source_url ? ` Quelle: ${change.source_url}` : ""}`.slice(0, 1_000),
    severity: "medium",
    severity_label: "Mittel",
    block_id: blockId,
  };
}

/** The source a question rests on, at the end of its text, so the editor can show it to the customer. */
function withSource(question: string, source: ContentFreshnessSource): string {
  const text = question.trim().replace(/\s*\(Quelle:[^)]*\)\s*$/, "");
  return `${text} (Quelle: ${source.url})`.slice(0, 800);
}

function outdatedQuestion(
  change: { old_text: string; new_text: string },
  block: ContentTextBlock | null,
  sentence: string,
  source: ContentFreshnessSource,
): ContentQuestion {
  return {
    kind: "outdated",
    question: withSource(`Stimmt diese Angabe noch: „${change.old_text}“?${change.new_text ? ` Die Websuche legt „${change.new_text}“ nahe.` : ""}`, source),
    field: null,
    placeholder: change.new_text || null,
    block_id: block?.id ?? null,
    section: block ? contentSectionName(block) : null,
    excerpt: sentence || null,
    blocking: true,
  };
}

function searchLimitFinding(): ContentFinding {
  return {
    title: "Websuche-Limit erreicht",
    problem: "Das Limit der Websuchen für diesen Schritt war erreicht; möglicherweise wurde nicht jede zeitkritische Aussage geprüft.",
    proposal: "Bei Bedarf mit „Mit Anmerkung wiederholen“ ab der Aktualitätsprüfung erneut prüfen lassen.",
    severity: "low",
    severity_label: "Hinweis",
    block_id: null,
  };
}

const PSEUDO_IDS = ["title", "meta_description"] as const;
type PseudoId = (typeof PSEUDO_IDS)[number];

/** The step's answer with every rule applied (see the module comment). */
export function normalizeAktualitaetOutput(
  json: unknown,
  context: ContentPipelineContext,
  research: Pick<AktualitaetResearch, "sources" | "searches" | "fetches" | "claims" | "search_limit_hit">,
): AktualitaetOutput {
  const r = rec(json);
  const input = context.blocks;
  const byId = new Map(input.map((b) => [b.id, b]));
  const modelBlocks = new Map(normalizeBlocks(r.blocks).map((b) => [b.id, b]));
  const allowed = new Map<string, ContentFreshnessSource>();
  for (const source of research.sources) {
    const key = normalizeSourceUrl(source.url);
    if (key && !allowed.has(key)) allowed.set(key, source);
  }
  const allowedSource = (url: string): ContentFreshnessSource | null => {
    const key = normalizeSourceUrl(url);
    return key ? (allowed.get(key) ?? null) : null;
  };
  const protectedIds = new Set<string>([CONTENT_HERO_BLOCK_ID, ...input.filter((b, i) => i === 0 || b.level === 1).map((b) => b.id)]);
  const keywords = pageKeywords(context);
  const facts = customerFactContext(context);
  const findings: ContentFinding[] = [];
  // Questions to the customer only with a source showing the fact changed; the rest is recorded, not asked.
  const questions: ContentQuestion[] = [];
  const unasked: ContentQuestion[] = [];
  for (const item of Array.isArray(r.questions) ? r.questions.slice(0, 20) : []) {
    const question = normalizeQuestions([item], new Set(byId.keys()))[0];
    if (!question) continue;
    const source = allowedSource(str(rec(item).source_url, 2_000));
    if (source) questions.push({ ...question, question: withSource(question.question, source) });
    else unasked.push(question);
  }

  // 1. Each proposed change on its own: source, place, size, customer fact.
  type Candidate = AktualitaetUpdate & { target: string };
  const candidates: Candidate[] = [];
  for (const item of Array.isArray(r.updates) ? r.updates.slice(0, MAX_UPDATES) : []) {
    const u = rec(item);
    const change = {
      block_id: str(u.block_id, 80),
      old_text: cleanQuote(str(u.old_text, 4_000)),
      new_text: cleanQuote(str(u.new_text, 4_000)),
      reason: str(u.reason, 600),
      source_url: str(u.source_url, 2_000),
    };
    if (!change.old_text || !change.new_text || change.old_text === change.new_text) continue;
    const pseudo = (PSEUDO_IDS as readonly string[]).includes(change.block_id) ? (change.block_id as PseudoId) : null;
    const block = byId.get(change.block_id) ?? null;
    const findingBlock = block?.id ?? null;
    if (!block && !pseudo) {
      findings.push(rejectedChange(change, "abschnitt", null, `Den Abschnitt „${change.block_id || "?"}“ gibt es im Text nicht`));
      continue;
    }
    const source = allowedSource(change.source_url);
    if (!source) {
      findings.push(rejectedChange(change, "quelle", findingBlock));
      continue;
    }
    if (block && protectedIds.has(block.id)) {
      findings.push(rejectedChange(change, "geschuetzt", findingBlock, "Die H1 und der Abschnitt „hero“ ändert dieser Schritt nicht"));
      continue;
    }
    if (URL_IN_TEXT_RE.test(change.new_text)) {
      findings.push(rejectedChange(change, "url", findingBlock, "Der neue Text enthielt eine Adresse; Quellen stehen nie im Seitentext"));
      continue;
    }
    if (change.old_text.length > MAX_CHANGE_CHARS || change.new_text.length > MAX_CHANGE_CHARS) {
      findings.push(rejectedChange(change, "umfang", findingBlock, "Das ist keine kleine Änderung mehr; ein überholter Abschnitt geht an GEO zurück"));
      continue;
    }
    const whole = block ? blockText(block) : pseudo === "title" ? (context.title ?? "") : (context.metaDescription ?? "");
    const sentence = sentenceOf(whole, change.old_text);
    const customer = customerFactReason(change, sentence, facts);
    if (customer) {
      questions.push(outdatedQuestion(change, block, sentence, source));
      continue;
    }
    candidates.push({
      ...change,
      section: block ? contentSectionName(block) : pseudo === "title" ? "Title-Tag" : "Meta-Description",
      source_url: source.url,
      source_title: str(u.source_title, 300) || source.title,
      target: block?.id ?? pseudo!,
    });
  }

  // 2. Apply per Abschnitt; the block as stored stays the base, so nothing else in it moves.
  const updates: AktualitaetUpdate[] = [];
  const changed = new Map<string, ContentTextBlock>();
  let title = context.title;
  let metaDescription = context.metaDescription;
  for (const target of [...new Set(candidates.map((c) => c.target))]) {
    const group = candidates.filter((c) => c.target === target);
    const strip = (c: Candidate): AktualitaetUpdate => ({
      block_id: c.block_id,
      section: c.section,
      old_text: c.old_text,
      new_text: c.new_text,
      reason: c.reason,
      source_url: c.source_url,
      source_title: c.source_title,
    });
    if (target === "title" || target === "meta_description") {
      let value = (target === "title" ? title : metaDescription) ?? "";
      for (const change of group) {
        const at = value.indexOf(change.old_text);
        if (at < 0) {
          findings.push(rejectedChange(change, "fundstelle", null));
          continue;
        }
        value = `${value.slice(0, at)}${change.new_text}${value.slice(at + change.old_text.length)}`;
        updates.push(strip(change));
      }
      if (target === "title") title = value || title;
      else metaDescription = value || metaDescription;
      continue;
    }
    const before = byId.get(target)!;
    let after: ContentTextBlock | null = before;
    for (const change of group) after = after ? replaceInBlock(after, change.old_text, change.new_text) : null;
    if (!after) {
      // Not verbatim in the stored HTML (emphasis inside the passage, other quotes): the model's
      // version of the block, but only if its declared changes are its only ones.
      const model = modelBlocks.get(target);
      after = model && onlyDeclaredChanges(model, before, group) ? { ...before, heading: model.heading ?? before.heading, html: model.html } : null;
    }
    if (!after) {
      for (const change of group) findings.push(rejectedChange(change, "fundstelle", target, "Die Stelle steht so nicht im Text"));
      continue;
    }
    const broken = brokenRule(before, after, keywords);
    if (broken) {
      for (const change of group) findings.push(rejectedChange(change, "regel", target, broken.replace(/\.$/, "")));
      continue;
    }
    changed.set(target, after);
    updates.push(...group.map(strip));
  }

  // 3. Every other Abschnitt exactly as it was: no silent rewrites.
  const blocks = input.map((b) => changed.get(b.id) ?? b);

  // 4. Outdated Abschnitte need a source from the research too.
  const outdated: ContentFreshnessSection[] = [];
  for (const item of Array.isArray(r.outdated_sections) ? r.outdated_sections.slice(0, MAX_SECTIONS) : []) {
    const s = rec(item);
    const problem = str(s.problem, 1_000);
    const suggestion = str(s.suggestion, 1_500);
    if (!problem && !suggestion) continue;
    const block = byId.get(str(s.block_id, 80)) ?? null;
    const seen = new Set<string>();
    const sources: ContentFreshnessSource[] = [];
    for (const raw of Array.isArray(s.sources) ? s.sources : []) {
      const src = allowedSource(str(rec(raw).url, 2_000));
      if (!src || seen.has(src.url)) continue;
      seen.add(src.url);
      sources.push({ url: src.url, title: str(rec(raw).title, 300) || src.title });
    }
    const section = block ? contentSectionName(block) : "Text";
    if (sources.length === 0) {
      findings.push({
        title: "Quelle fehlt",
        problem: `Die Aktualitätsprüfung hält den Abschnitt „${section}“ für veraltet, nennt aber keine Quelle aus der Websuche: ${problem}`.slice(0, 1_000),
        proposal: suggestion ? `Prüfen: ${suggestion}`.slice(0, 1_000) : "Abschnitt prüfen.",
        severity: "medium",
        severity_label: "Mittel",
        block_id: block?.id ?? null,
      });
      continue;
    }
    outdated.push({ block_id: block?.id ?? null, section, problem, suggestion, sources: sources.slice(0, 5) });
  }

  // 5. What was checked, for the record; a source only if the research returned it.
  const checked: AktualitaetCheck[] = [];
  for (const item of Array.isArray(r.checked) ? r.checked.slice(0, MAX_CHECKED) : []) {
    const c = rec(item);
    const claim = str(c.claim, 400);
    const status = str(c.status, 40) as AktualitaetStatus;
    if (!claim || !(AKTUALITAET_STATUSES as readonly string[]).includes(status)) continue;
    const blockId = str(c.block_id, 80);
    checked.push({
      block_id: byId.has(blockId) ? blockId : null,
      claim,
      status,
      source_url: allowedSource(str(c.source_url, 2_000))?.url ?? null,
    });
  }

  if (research.search_limit_hit) findings.push(searchLimitFinding());

  return {
    blocks,
    title,
    meta_description: metaDescription,
    checked,
    updates,
    questions: dedupeQuestions(questions),
    unasked_questions: unasked,
    outdated_sections: outdated,
    findings,
    research: researchSummary(research),
  };
}

/** One question per sentence of an Abschnitt: the model's own and the code's for the same passage are one. */
function dedupeQuestions(questions: readonly ContentQuestion[]): ContentQuestion[] {
  const seen = new Set<string>();
  return questions.filter((q) => {
    const key = `${q.block_id ?? ""}|${looseText(q.excerpt || q.question)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function researchSummary(
  research: Pick<AktualitaetResearch, "sources" | "searches" | "fetches" | "claims" | "search_limit_hit">,
): AktualitaetOutput["research"] {
  return {
    searches: research.searches,
    fetches: research.fetches,
    sources: research.sources.length,
    claims: research.claims,
    search_limit_hit: research.search_limit_hit,
  };
}

/** The research found no time-sensitive statement: the text stays, no result call is needed. */
export function unchangedAktualitaetOutput(
  context: Pick<ContentPipelineContext, "blocks" | "title" | "metaDescription">,
  research: Pick<AktualitaetResearch, "sources" | "searches" | "fetches" | "claims" | "search_limit_hit">,
): AktualitaetOutput {
  return {
    blocks: [...context.blocks],
    title: context.title,
    meta_description: context.metaDescription,
    checked: [],
    updates: [],
    questions: [],
    unasked_questions: [],
    outdated_sections: [],
    findings: [],
    research: researchSummary(research),
  };
}

/** True when the result call can be skipped: nothing time-sensitive and nothing searched. */
export function aktualitaetNeedsNoResult(research: Pick<AktualitaetResearch, "claims" | "sources">): boolean {
  return research.claims === 0 && research.sources.length === 0;
}
