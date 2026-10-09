/**
 * Prompts, tool schemas and output normalisation for the eight steps, ported from the
 * rules of the old Step-by-Step-Content-Agent (step1_analyse … step5_vermenschlichung).
 * Pure: no Supabase, no Anthropic client. `run-step.ts` wires them to the model.
 *
 * Every step receives the same context blocks: the page with its Excel briefing, the
 * Anbieterfakten (only source of facts), the confirmed settings (Anrede, Branche,
 * Tonalität, verbotene Wörter), the avatar and the editor's notes.
 */

import type Anthropic from "@anthropic-ai/sdk";

import type { ContentPageKeywords } from "@/lib/dt/content/excel-structure";
import {
  CONTENT_BRANCHE_LABELS,
  contentTonalitaetText,
  type ContentTextSettings,
  type WorkshopAnbieterSection,
} from "@/lib/dt/content/mapping";
import {
  CONTENT_PAGE_ROLE_LABELS,
  CONTENT_PAGE_TYPE_LABELS,
  type ContentPageRole,
  type ContentPageType,
} from "@/lib/dt/content/page-types";
import { CONTENT_STEP_ANALYSE, CONTENT_STEP_FAKTENCHECK, CONTENT_STEP_LEKTORAT } from "@/lib/dt/content/pipeline/steps";
import { blocksToPromptText, escapeHtml, normalizeBlocks, type ContentTextBlock } from "@/lib/dt/content/render";
import { renderContentTypePrompt, type ContentTypePrompts } from "@/lib/dt/content/type-prompts";
import type { ContentFinding, ContentPageSource, ContentQuestion } from "@/lib/dt/content/types";

export type ContentPipelinePage = {
  name: string;
  path: string | null;
  level: number;
  url?: string | null;
  source: ContentPageSource;
  page_role: ContentPageRole | null;
  /** Effective type (a row without one gets a guess before the prompt is built). */
  page_type: ContentPageType;
  pillar_name: string | null;
  estimated_traffic: number | null;
  keywords: ContentPageKeywords | null;
  h1_options: string[];
  user_questions: string[];
  ki_prompt: string | null;
  internal_link_targets: string[];
};

export type ContentPipelineContext = {
  organisationName: string;
  page: ContentPipelinePage;
  /** The other pages of the organisation (name, type, keyword) for cannibalisation and deferred questions. */
  structureOutline: string;
  /** Current text of the live page for pages taken over from the crawl; null otherwise. */
  existingText: string | null;
  sections: WorkshopAnbieterSection[];
  settings: ContentTextSettings;
  avatar: { name: string; role: string; beschreibung: string } | null;
  /** The agency's writing recipes per page type („Textvorlagen“); only the SEO step reads them. */
  typePrompts: ContentTypePrompts;
  /** Human notes from "Mit Anmerkung wiederholen", oldest first. */
  notes: string[];
  /** Normalised outputs of earlier steps, by step number. */
  outputs: Partial<Record<number, unknown>>;
  /** Current text (page HTML parsed into blocks); empty before step 2. */
  blocks: ContentTextBlock[];
  title: string | null;
  metaDescription: string | null;
};

// --- allowed values of the Analyse (from the old step1_analyse rules) --------------------------

export const CONTENT_INTENTS = ["informationell", "navigational", "transaktional", "kommerziell-vergleichend"] as const;
export const CONTENT_INTENT_MODIFIERS = ["lokal", "problemorientiert", "ymyl"] as const;
export const CONTENT_JOURNEY_PHASES = [
  "problembewusstsein",
  "loesungssuche",
  "anbietervergleich",
  "entscheidung",
  "nach_dem_auftrag",
] as const;
export const CONTENT_CONVERSION_GOALS = [
  "anfrage",
  "anruf",
  "termin",
  "angebot",
  "rueckruf",
  "newsletter",
  "download",
  "weiterlesen",
] as const;
export const CONTENT_ANGLES = [
  "problem_loesung",
  "ablauf_und_prozess",
  "vergleich_und_entscheidung",
  "lokaler_anbieter",
  "vertrauen_und_beweise",
  "kosten_und_preis",
  "ratgeber_und_anleitung",
  "checkliste",
] as const;
export const CONTENT_QUESTION_SOURCES = ["Spalte H", "Recherche", "Avatar", "Anbieterfakten"] as const;

export type AnalyseOutput = {
  intent: { primary: (typeof CONTENT_INTENTS)[number]; modifiers: (typeof CONTENT_INTENT_MODIFIERS)[number][] };
  journey_phase: (typeof CONTENT_JOURNEY_PHASES)[number];
  conversion_goal: (typeof CONTENT_CONVERSION_GOALS)[number];
  content_angle: (typeof CONTENT_ANGLES)[number];
  main_keyword: string;
  secondary_keywords: string[];
  main_question: string;
  fanout_questions: Array<{ question: string; source: string; theme: string }>;
  deferred_questions: Array<{ question: string; link_to: string; short_answer_hint: string }>;
  dropped_questions: Array<{ question: string; reason: string }>;
  hormozi: {
    traumziel: string;
    hauptschmerz: string;
    groesste_huerde: string;
    moeglicher_beweis: string;
    gewuenschter_cta: string;
  };
  usable_facts: string[];
  missing_facts: string[];
  assumptions: string[];
};

export type TextOutput = {
  blocks: ContentTextBlock[];
  title: string | null;
  meta_description: string | null;
};

export type SelfScore = { direktheit: number; rhythmus: number; vertrauen: number; natuerlichkeit: number; dichte: number };
export type VermenschlichungOutput = TextOutput & { self_score: SelfScore | null };
export type FaktencheckOutput = { findings: ContentFinding[]; questions: ContentQuestion[] };
export type LektoratOutput = TextOutput & { final_findings: ContentFinding[] };
export type EndabnahmeOutput = { unresolved: ContentFinding[]; summary: string };

export type ContentStepSpec = {
  system: string;
  user: string;
  tool: Anthropic.Tool;
  maxTokens: number;
  normalize: (json: unknown, context: ContentPipelineContext) => unknown;
  /**
   * Optional second attempt inside the same step: returns the extra instruction for the
   * retry when the first output is not good enough, null when it is. At most one retry.
   */
  retryHint?: (output: unknown) => string | null;
  /** Ranks two outputs of the same step; the higher one is kept after a retry. */
  score?: (output: unknown) => number;
};

/** The SEO step leaves this heading; Hormozi (step 5) replaces it with the hero sentence. */
export const CONTENT_HERO_PLACEHOLDER = "[HERO – wird in Schritt 5 gefuellt]";
export const CONTENT_HERO_BLOCK_ID = "hero";
/** Sum of the five self-scores (1–10 each) under which the Vermenschlichung tries once more. */
export const CONTENT_SELF_SCORE_MIN = 35;

/** Phrases the Vermenschlichung replaces (the old floskeln list). */
export const CONTENT_FLOSKELN = [
  "In der heutigen schnelllebigen Zeit",
  "Es ist wichtig zu beachten",
  "spielt eine entscheidende Rolle",
  "nahtlos",
  "ganzheitlich",
  "maßgeschneidert",
  "Rundum-sorglos",
  "Ihr zuverlässiger Partner",
  "Wir legen großen Wert auf",
  "Tauchen wir ein",
  "Doch was bedeutet das konkret",
  "Die Antwort ist einfach",
  "Die Gründe sind vielfältig",
  "nicht nur, sondern auch",
  "Es versteht sich von selbst",
] as const;
export const CONTENT_FUELLWOERTER = ["natürlich", "selbstverständlich", "grundsätzlich", "eigentlich", "im Grunde", "tatsächlich", "durchaus"] as const;

const MAX_SECTION_CHARS = 6_000;
const MAX_AVATAR_CHARS = 5_000;
const MAX_OUTLINE_CHARS = 5_000;
const MAX_EXISTING_TEXT_CHARS = 6_000;
const MAX_OUTPUT_CHARS = 12_000;

const SEVERITY_LABELS: Record<string, string> = {
  high: "Wichtig",
  medium: "Mittel",
  low: "Hinweis",
};

// --- helpers --------------------------------------------------------------------------------

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}\n… (gekürzt)` : t;
}

function str(value: unknown, max = 2_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function strList(value: unknown, max = 30): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => str(v, 400))
    .filter(Boolean)
    .slice(0, max);
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function dedupeText(values: readonly string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase().replace(/[?!.\s]+$/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeFindings(raw: unknown, knownBlockIds: ReadonlySet<string>): ContentFinding[] {
  if (!Array.isArray(raw)) return [];
  const out: ContentFinding[] = [];
  for (const item of raw.slice(0, 30)) {
    const r = rec(item);
    const title = str(r.title, 200);
    const problem = str(r.problem, 1_000);
    if (!title && !problem) continue;
    const severity = ["high", "medium", "low"].includes(String(r.severity)) ? String(r.severity) : "medium";
    const blockId = str(r.block_id, 80);
    out.push({
      title: title || problem.slice(0, 80),
      problem,
      proposal: str(r.proposal, 1_000),
      severity,
      severity_label: SEVERITY_LABELS[severity] ?? "Mittel",
      block_id: knownBlockIds.has(blockId) ? blockId : null,
    });
  }
  return out;
}

export function normalizeQuestions(raw: unknown, knownBlockIds: ReadonlySet<string>): ContentQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ContentQuestion[] = [];
  for (const item of raw.slice(0, 20)) {
    const r = rec(item);
    const question = str(r.question, 600);
    if (!question) continue;
    const blockId = str(r.block_id, 80);
    out.push({
      kind: ["fact", "decision", "missing"].includes(String(r.kind)) ? String(r.kind) : "fact",
      question,
      field: str(r.field, 80) || null,
      placeholder: str(r.placeholder, 200) || null,
      block_id: knownBlockIds.has(blockId) ? blockId : null,
      excerpt: str(r.excerpt, 500) || null,
      blocking: r.blocking !== false,
    });
  }
  return out;
}

function blockIds(blocks: readonly ContentTextBlock[]): Set<string> {
  return new Set(blocks.map((b) => b.id));
}

function normalizeTextOutput(json: unknown, context: ContentPipelineContext): TextOutput {
  const r = rec(json);
  const blocks = normalizeBlocks(r.blocks);
  return {
    blocks: blocks.length > 0 ? blocks : context.blocks,
    title: str(r.title, 200) || context.title,
    meta_description: str(r.meta_description, 400) || context.metaDescription,
  };
}

export function isHeroPlaceholder(block: ContentTextBlock | null | undefined): boolean {
  if (!block) return false;
  return /\[HERO\b/i.test(`${block.heading ?? ""} ${block.html}`);
}

export function heroBlock(blocks: readonly ContentTextBlock[]): ContentTextBlock | null {
  return blocks.find((b) => b.id === CONTENT_HERO_BLOCK_ID) ?? null;
}

/**
 * The SEO step's text must carry the hero placeholder right under the H1. The model's own
 * hero block is reset to the placeholder (no real hero before Hormozi); a missing one is
 * inserted; the first block is the H1.
 */
export function ensureHeroPlaceholder(blocks: readonly ContentTextBlock[]): ContentTextBlock[] {
  const placeholder: ContentTextBlock = { id: CONTENT_HERO_BLOCK_ID, heading: CONTENT_HERO_PLACEHOLDER, level: 2, html: "" };
  const rest = blocks.filter((b) => b.id !== CONTENT_HERO_BLOCK_ID);
  if (rest.length === 0) return [];
  const [first, ...others] = rest;
  return [{ ...first!, level: 1 }, placeholder, ...others];
}

/**
 * Later rewrites must not lose the hero block (GEO/Lektorat keep the placeholder, Hormozi
 * fills it). When the model dropped it, the previous version returns right after the H1.
 */
export function keepHeroBlock(blocks: readonly ContentTextBlock[], previous: readonly ContentTextBlock[]): ContentTextBlock[] {
  const before = heroBlock(previous);
  if (!before || heroBlock(blocks) || blocks.length === 0) return [...blocks];
  const [first, ...others] = blocks;
  return [first!, { ...before }, ...others];
}

/**
 * Hormozi's hero: one sentence as a paragraph, no heading, so the H1 stays the only H1 and
 * no H2 carries marketing copy. A sentence the model put into the heading moves into the body.
 */
export function settleHeroSentence(blocks: readonly ContentTextBlock[]): ContentTextBlock[] {
  return blocks.map((b) => {
    if (b.id !== CONTENT_HERO_BLOCK_ID || isHeroPlaceholder(b)) return b;
    const heading = b.heading?.trim() ?? "";
    if (!heading) return { ...b, heading: null, level: 2 };
    const body = b.html.trim();
    const alreadyInBody = body.toLowerCase().includes(heading.toLowerCase());
    const html = alreadyInBody ? body : `<p><strong>${escapeHtml(heading)}</strong></p>${body ? `\n${body}` : ""}`;
    return { ...b, heading: null, level: 2, html };
  });
}

// --- shared prompt parts ----------------------------------------------------------------------

function anbieterBlock(context: ContentPipelineContext): string {
  const filled = context.sections.filter((s) => s.current.trim());
  if (filled.length === 0) return "## Anbieterfakten\n(keine)";
  return [
    "## Anbieterfakten aus Fragebogen und Kundengesprächen (einzige Quelle für Tatsachen)",
    ...filled.map((s) => `### ${s.label}\n${clip(s.current, MAX_SECTION_CHARS)}`),
  ].join("\n\n");
}

function settingsBlock(settings: ContentTextSettings): string {
  const forbidden = settings.verbotene_woerter.length
    ? settings.verbotene_woerter.map((w) => `„${w}“`).join(", ")
    : "keine";
  return [
    "## Vorgaben",
    `Anrede: ${settings.anrede === "Du" ? "Du (Leser werden geduzt)" : "Sie (Leser werden gesiezt)"}`,
    `Branche: ${CONTENT_BRANCHE_LABELS[settings.branche]}`,
    `Tonalität: ${contentTonalitaetText(settings.tonalitaet)}`,
    `Verbotene Wörter (dürfen nirgends vorkommen, auch nicht in Überschriften): ${forbidden}`,
  ].join("\n");
}

function brancheRules(settings: ContentTextSettings): string {
  switch (settings.branche) {
    case "rechtsanwalt":
      return "Branchenregel Kanzlei: keine Erfolgsversprechen, keine Garantien zum Ausgang eines Verfahrens, keine Superlative wie „der beste Anwalt“. Fachgebiete nur nennen, wenn sie in den Anbieterfakten stehen.";
    case "arzt":
      return "Branchenregel Praxis (Heilmittelwerbegesetz): keine Heilversprechen, keine Erfolgsquoten, keine Vorher-nachher-Vergleiche, keine Angst machenden Formulierungen. Behandlungen nur nennen, wenn sie in den Anbieterfakten stehen.";
    default:
      return "Branchenregel Handwerk & Dienstleistung: Preise, Fristen und Garantien nur so, wie sie in den Anbieterfakten stehen. Keine erfundenen Referenzen oder Zahlen.";
  }
}

function avatarBlock(context: ContentPipelineContext): string {
  if (!context.avatar) return "## Avatar (Wunschkunde)\n(kein Avatar hinterlegt)";
  return [
    "## Avatar (Wunschkunde, für den der Text geschrieben wird)",
    `Name: ${context.avatar.name}`,
    context.avatar.role ? `Rolle: ${context.avatar.role}` : "",
    clip(context.avatar.beschreibung, MAX_AVATAR_CHARS),
  ]
    .filter(Boolean)
    .join("\n");
}

function keywordText(k: { text: string; volume?: number }): string {
  return k.volume != null ? `${k.text} (${k.volume}/Monat)` : k.text;
}

function list(items: readonly string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

function pageBlock(context: ContentPipelineContext): string {
  const { page } = context;
  const structure = page.source === "structure";
  const lines = [
    "## Seite",
    `Organisation: ${context.organisationName}`,
    `Seite: ${page.name}`,
    page.path ? `Pfad: ${page.path}` : "",
    page.url ? `Live-URL: ${page.url}` : "",
    `Quelle: ${structure ? "Excel-Seitenstruktur (Briefing der Redaktion)" : "Crawl der bestehenden Website (kein Briefing, Keywords und Fragen werden hier erarbeitet)"}`,
    `Rolle in der Struktur: ${page.page_role ? CONTENT_PAGE_ROLE_LABELS[page.page_role] : "keine (Crawl-Seite)"} · Ebene ${page.level} (0 = Startseite)`,
    `Seitentyp: ${CONTENT_PAGE_TYPE_LABELS[page.page_type]}`,
    page.pillar_name ? `Hauptsilo (übergeordnete Seite): ${page.pillar_name}` : "",
    page.estimated_traffic != null ? `Geschätzter Traffic laut Excel: ${page.estimated_traffic}` : "",
    page.keywords
      ? `Hauptkeyword aus der Excel (gesetzt, nicht ersetzen): ${keywordText(page.keywords.main)}`
      : "Hauptkeyword: nicht vorgegeben",
    page.keywords && page.keywords.secondary.length > 0
      ? `Nebenkeywords aus der Excel: ${page.keywords.secondary.map(keywordText).join(", ")}`
      : "",
    page.h1_options.length > 0 ? `H1-Optionen aus der Excel:\n${list(page.h1_options)}` : "",
    page.user_questions.length > 0
      ? `Nutzerfragen aus Spalte H (echte Google-Fragen, haben Vorrang vor erfundenen Fragen):\n${list(page.user_questions)}`
      : "",
    page.ki_prompt ? `KI-Prompt der Redaktion für diese Seite (stehende Anweisung):\n${clip(page.ki_prompt, 2_000)}` : "",
    page.internal_link_targets.length > 0
      ? `Erlaubte interne Linkziele (nur diese, als Marker [LINK: Seitenname]): ${page.internal_link_targets.join(" · ")}`
      : "Erlaubte interne Linkziele: keine bekannt – keine internen Links setzen",
    context.structureOutline
      ? `\n## Weitere Seiten der Website (zur Abgrenzung: welche Fragen gehören auf eine andere Seite; keine Fakten)\n${clip(context.structureOutline, MAX_OUTLINE_CHARS)}`
      : "",
    context.existingText
      ? `\n## Bisheriger Text der Seite (Live-Website, nur zur Orientierung)\nSo liest sich die Seite heute: Thema, Umfang, Begriffe. Fakten daraus gelten nur, wenn sie auch in den Anbieterfakten stehen – sonst sind sie unbelegt.\n${clip(context.existingText, MAX_EXISTING_TEXT_CHARS)}`
      : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function notesBlock(context: ContentPipelineContext): string {
  const notes = [
    ...(context.page.ki_prompt ? [`KI-Prompt aus der Seitenstruktur: ${clip(context.page.ki_prompt, 2_000)}`] : []),
    ...context.notes.map((n) => clip(n, 2_000)),
  ];
  if (notes.length === 0) return "";
  return [
    "## Anmerkungen der Redaktion (gelten vor allem anderen; Antworten darin sind bestätigte Fakten)",
    ...notes.map((n, i) => `${i + 1}. ${n}`),
  ].join("\n");
}

function outputBlock(context: ContentPipelineContext, step: number, title: string, max = MAX_OUTPUT_CHARS): string {
  const output = context.outputs[step];
  if (!output) return "";
  return `## ${title}\n${JSON.stringify(output, null, 1).slice(0, max)}`;
}

function currentTextBlock(context: ContentPipelineContext): string {
  if (context.blocks.length === 0) return "## Aktueller Text\n(noch keiner)";
  return [
    "## Aktueller Text (Abschnitte mit ihrer id)",
    context.title ? `Title-Tag: ${context.title}` : "",
    context.metaDescription ? `Meta-Description: ${context.metaDescription}` : "",
    blocksToPromptText(context.blocks),
  ]
    .filter(Boolean)
    .join("\n");
}

function join(parts: readonly string[]): string {
  return parts.filter(Boolean).join("\n\n");
}

const BASE_RULES = `Du arbeitest für eine Agentur, die Webseitentexte für kleine Unternehmen schreibt. Sprache: Deutsch.
Tatsachen (Leistungen, Zahlen, Namen, Preise, Abläufe, Orte) kommen ausschließlich aus den Anbieterfakten und den Anmerkungen der Redaktion. Nichts erfinden, nichts aus Branchenwissen ergänzen. Fehlt eine Angabe, bleibt sie weg oder wird als offene Frage gemeldet.
Anrede, Tonalität und verbotene Wörter aus den Vorgaben gelten ohne Ausnahme.`;

const KEEP_RULES =
  "Unverändert bleiben: die H1, der Abschnitt „hero“, Frage-Überschriften (bleiben Fragen), Haupt- und Nebenkeywords, Platzhalter wie [BITTE PRÜFEN: …] und [QUELLE BITTE ERGÄNZEN], [LINK: …]-Marker, die ids der Abschnitte und alle Fakten.";

const BLOCKS_SCHEMA = {
  type: "array",
  description:
    "Der komplette Text als geordnete Abschnitte. Der erste Abschnitt trägt die H1 (level 1), danach H2 (level 2), bei Bedarf H3 (level 3). Bestehende ids beibehalten.",
  items: {
    type: "object",
    properties: {
      id: { type: "string", description: "Kurze, stabile Kennung in Kleinbuchstaben, z. B. hero, zusammenfassung, einleitung, ablauf. Bestehende ids beibehalten." },
      heading: { type: "string", description: "Überschrift ohne HTML. Leer, wenn der Abschnitt keine hat." },
      level: { type: "integer", enum: [1, 2, 3] },
      html: {
        type: "string",
        description: "Fließtext als HTML mit <p>, <ul>/<ol>/<li>, <strong>, <em>. Keine Überschrift hier, kein <section>, kein <div>, keine <a>-Tags (interne Links als [LINK: Seitenname]).",
      },
    },
    required: ["id", "heading", "level", "html"],
  },
} as const;

const FINDINGS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      title: { type: "string", description: "Kurztitel, max. 8 Wörter." },
      problem: { type: "string", description: "Was genau ist das Problem, mit Zitat der Stelle." },
      proposal: { type: "string", description: "Konkreter Vorschlag, wie es zu lösen ist." },
      severity: { type: "string", enum: ["high", "medium", "low"] },
      block_id: { type: "string", description: "id des betroffenen Abschnitts, oder leer." },
    },
    required: ["title", "problem", "proposal", "severity", "block_id"],
  },
} as const;

const TEXT_PROPERTIES = {
  title: { type: "string", description: "Title-Tag, max. 60 Zeichen. Leer lassen, wenn unverändert." },
  meta_description: { type: "string", description: "Meta-Description, max. 155 Zeichen. Leer lassen, wenn unverändert." },
  blocks: BLOCKS_SCHEMA,
};

const TEXT_TOOL_SCHEMA: Anthropic.Tool["input_schema"] = {
  type: "object",
  properties: TEXT_PROPERTIES,
  required: ["title", "meta_description", "blocks"],
};

// --- page type variants of the SEO step --------------------------------------------------------

/**
 * The recipe („Textvorlage“) for this page's type, from the agency's editable set; the
 * defaults are the rules that used to be fixed here. Each page writes with its own type.
 */
function pageTypeRules(context: ContentPipelineContext): string {
  return renderContentTypePrompt(context.typePrompts, context.page.page_type, context.page.pillar_name);
}

// --- the eight steps ---------------------------------------------------------------------------

function analyse(context: ContentPipelineContext): ContentStepSpec {
  const { page } = context;
  const crawl = page.source === "crawl";
  return {
    maxTokens: 6_000,
    system: `${BASE_RULES}

Schritt 1 Analyse: Du legst fest, wonach Menschen suchen, wenn sie diese Seite brauchen, welche Fragen sie dabei haben, was die Seite leisten muss und welche Fakten dafür belegt sind. Du schreibst die Seite NICHT.

Suchintention: intent.primary ist genau einer von ${CONTENT_INTENTS.join(" | ")}; modifiers aus ${CONTENT_INTENT_MODIFIERS.join(" | ")} (mehrere möglich, ymyl = Gesundheit, Recht, Geld). journey_phase: ${CONTENT_JOURNEY_PHASES.join(" | ")}. conversion_goal: ${CONTENT_CONVERSION_GOALS.join(" | ")}. content_angle: ${CONTENT_ANGLES.join(" | ")}. Nur diese Werte.
Keywords: ${
      page.keywords
        ? "Das Hauptkeyword aus der Excel ist gesetzt – übernimm es wörtlich als main_keyword, nicht ersetzen, nicht umformulieren. Nebenkeywords aus der Excel übernehmen und um 2–5 passende Varianten ergänzen; kein Suchvolumen erfinden."
        : crawl
          ? "Diese Seite kommt aus dem Crawl, ohne Briefing: Leite Haupt- und Nebenkeywords aus Seite, Leistung, Avatar und Ort (nur wenn der Anbieter regional arbeitet und ein Ort in den Fakten steht) ab. Der bisherige Text ist nur Orientierung für Thema und Begriffe."
          : "Es gibt kein Hauptkeyword aus der Excel: leite es aus Seite, Leistung und Ort (nur aus den Fakten) ab, 2–5 Wörter."
    }
main_question: die eine Frage, die der Suchende sich selbst stellt. Nie eine Frage AN den Kunden („Welche Leistungen bieten Sie?“ ist falsch), nie mit Firmenname.
fanout_questions: mindestens 8 Fragen, die eine vollständige Antwort auf main_question abdecken muss (KI-Suchen fächern so auf). ${
      page.user_questions.length > 0
        ? "Die Nutzerfragen aus Spalte H sind echte Google-Fragen: alle übernehmen, Wortlaut beibehalten, source „Spalte H“. Weitere Fragen ergänzen mit source „Recherche“, „Avatar“ oder „Anbieterfakten“."
        : "source je Frage: „Recherche“ (aus der Suchlogik), „Avatar“ (aus seinen Sorgen) oder „Anbieterfakten“ (aus dem, was der Anbieter beantworten kann)."
    } theme: das Unterthema in 1–3 Wörtern.
deferred_questions: Fragen, die eine andere Seite der Website besser beantwortet (keine Kannibalisierung) – link_to ist der Name dieser Seite (nur erlaubte Linkziele oder Seiten aus der Website-Liste), short_answer_hint sagt, wie diese Seite in einem Satz darauf verweist.
dropped_questions: Fragen, die hier nicht hingehören, mit reason.
hormozi: traumziel (was der Avatar wirklich will), hauptschmerz, groesste_huerde (was ihn vom Auftrag abhält), moeglicher_beweis (nur belegte Beweise aus den Anbieterfakten; sonst „kein belegter Beweis“), gewuenschter_cta (passend zu conversion_goal und den Kontaktwegen aus den Fakten). Nur aus Avatar und Anbieterfakten, nichts erfinden.
usable_facts: belegte Fakten für diese Seite, je ein Satz. missing_facts: was der Text bräuchte, aber nirgends belegt ist – lieber benennen als später erfinden. assumptions: was du ohne Beleg annimmst.`,
    user: join([pageBlock(context), anbieterBlock(context), settingsBlock(context.settings), avatarBlock(context), notesBlock(context)]),
    tool: {
      name: "submit_analyse",
      description: "Suchintention, Keywords, Fragen, Hormozi-Bausteine und Faktenlage für diese Seite.",
      input_schema: {
        type: "object",
        properties: {
          intent: {
            type: "object",
            properties: {
              primary: { type: "string", enum: [...CONTENT_INTENTS] },
              modifiers: { type: "array", items: { type: "string", enum: [...CONTENT_INTENT_MODIFIERS] } },
            },
            required: ["primary", "modifiers"],
          },
          journey_phase: { type: "string", enum: [...CONTENT_JOURNEY_PHASES] },
          conversion_goal: { type: "string", enum: [...CONTENT_CONVERSION_GOALS] },
          content_angle: { type: "string", enum: [...CONTENT_ANGLES] },
          main_keyword: { type: "string", description: "Hauptsuchbegriff, 2–5 Wörter; aus der Excel, wenn dort vorgegeben." },
          secondary_keywords: { type: "array", items: { type: "string" }, description: "3–10 Nebenbegriffe und Synonyme." },
          main_question: { type: "string", description: "Die Frage des Suchenden, ohne Firmenname." },
          fanout_questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                source: { type: "string", enum: [...CONTENT_QUESTION_SOURCES] },
                theme: { type: "string" },
              },
              required: ["question", "source", "theme"],
            },
          },
          deferred_questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                link_to: { type: "string", description: "Name der Seite, die die Frage beantwortet." },
                short_answer_hint: { type: "string" },
              },
              required: ["question", "link_to", "short_answer_hint"],
            },
          },
          dropped_questions: {
            type: "array",
            items: {
              type: "object",
              properties: { question: { type: "string" }, reason: { type: "string" } },
              required: ["question", "reason"],
            },
          },
          hormozi: {
            type: "object",
            properties: {
              traumziel: { type: "string" },
              hauptschmerz: { type: "string" },
              groesste_huerde: { type: "string" },
              moeglicher_beweis: { type: "string" },
              gewuenschter_cta: { type: "string" },
            },
            required: ["traumziel", "hauptschmerz", "groesste_huerde", "moeglicher_beweis", "gewuenschter_cta"],
          },
          usable_facts: { type: "array", items: { type: "string" } },
          missing_facts: { type: "array", items: { type: "string" } },
          assumptions: { type: "array", items: { type: "string" } },
        },
        required: [
          "intent",
          "journey_phase",
          "conversion_goal",
          "content_angle",
          "main_keyword",
          "secondary_keywords",
          "main_question",
          "fanout_questions",
          "deferred_questions",
          "dropped_questions",
          "hormozi",
          "usable_facts",
          "missing_facts",
          "assumptions",
        ],
      },
    },
    normalize: (json, ctx): AnalyseOutput => normalizeAnalyse(json, ctx),
  };
}

export function normalizeAnalyse(json: unknown, context: ContentPipelineContext): AnalyseOutput {
  const r = rec(json);
  const intent = rec(r.intent);
  const { page } = context;
  const excelMain = page.keywords?.main.text ?? "";
  const excelSecondary = page.keywords?.secondary.map((k) => k.text) ?? [];
  const excelQuestions = page.user_questions;
  const questionKey = (q: string) => q.trim().toLowerCase().replace(/[?!.\s]+$/g, "");
  const excelKeys = new Set(excelQuestions.map(questionKey));

  const fanout: AnalyseOutput["fanout_questions"] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(r.fanout_questions) ? r.fanout_questions.slice(0, 30) : []) {
    const q = rec(item);
    const question = str(q.question, 400);
    const key = questionKey(question);
    if (!question || seen.has(key)) continue;
    seen.add(key);
    const fromExcel = excelKeys.has(key);
    fanout.push({
      question,
      source: fromExcel ? "Spalte H" : oneOf(q.source, CONTENT_QUESTION_SOURCES, "Recherche"),
      theme: str(q.theme, 80),
    });
  }
  // Real Google questions never fall off the list, whatever the model kept.
  for (const question of excelQuestions) {
    const key = questionKey(question);
    if (seen.has(key)) continue;
    seen.add(key);
    fanout.push({ question, source: "Spalte H", theme: "" });
  }

  const deferred: AnalyseOutput["deferred_questions"] = [];
  for (const item of Array.isArray(r.deferred_questions) ? r.deferred_questions.slice(0, 20) : []) {
    const q = rec(item);
    const question = str(q.question, 400);
    if (!question) continue;
    deferred.push({ question, link_to: str(q.link_to, 200), short_answer_hint: str(q.short_answer_hint, 400) });
  }
  const dropped: AnalyseOutput["dropped_questions"] = [];
  for (const item of Array.isArray(r.dropped_questions) ? r.dropped_questions.slice(0, 20) : []) {
    const q = rec(item);
    const question = str(q.question, 400);
    if (!question) continue;
    dropped.push({ question, reason: str(q.reason, 400) });
  }
  const h = rec(r.hormozi);
  const intentFallback = page.page_type === "ratgeber" ? "informationell" : "transaktional";
  return {
    intent: {
      primary: oneOf(intent.primary, CONTENT_INTENTS, intentFallback),
      modifiers: strList(intent.modifiers, 3).filter((m): m is (typeof CONTENT_INTENT_MODIFIERS)[number] =>
        (CONTENT_INTENT_MODIFIERS as readonly string[]).includes(m),
      ),
    },
    journey_phase: oneOf(r.journey_phase, CONTENT_JOURNEY_PHASES, "loesungssuche"),
    conversion_goal: oneOf(r.conversion_goal, CONTENT_CONVERSION_GOALS, page.page_type === "ratgeber" ? "weiterlesen" : "anfrage"),
    content_angle: oneOf(r.content_angle, CONTENT_ANGLES, page.page_type === "ratgeber" ? "ratgeber_und_anleitung" : "problem_loesung"),
    main_keyword: excelMain || str(r.main_keyword, 120),
    secondary_keywords: dedupeText([...excelSecondary, ...strList(r.secondary_keywords, 15)], 15).filter(
      (k) => k.toLowerCase() !== (excelMain || str(r.main_keyword, 120)).toLowerCase(),
    ),
    main_question: str(r.main_question, 300),
    fanout_questions: fanout,
    deferred_questions: deferred,
    dropped_questions: dropped,
    hormozi: {
      traumziel: str(h.traumziel, 400),
      hauptschmerz: str(h.hauptschmerz, 400),
      groesste_huerde: str(h.groesste_huerde, 400),
      moeglicher_beweis: str(h.moeglicher_beweis, 400),
      gewuenschter_cta: str(h.gewuenschter_cta, 400),
    },
    usable_facts: strList(r.usable_facts, 40),
    missing_facts: strList(r.missing_facts, 20),
    assumptions: strList(r.assumptions, 20),
  };
}

function seo(context: ContentPipelineContext): ContentStepSpec {
  const { page } = context;
  const minQuestions = page.page_type === "ratgeber" ? 5 : 3;
  return {
    maxTokens: 12_000,
    system: `${BASE_RULES}

Schritt 2 SEO: Du schreibst den vollständigen Seitentext auf Basis der Analyse (Schritt 1) und der belegten Fakten.
${pageTypeRules(context)}

Festes Gerüst, in dieser Reihenfolge:
1. H1 (erster Abschnitt, level 1): kurz, das Hauptkeyword steht vorn. Enthält eine H1-Option aus der Excel das Hauptkeyword, nimm sie wörtlich; sonst formulierst du selbst.
2. Direkt darunter ein Abschnitt mit id „hero“, level 2, Überschrift exakt „${CONTENT_HERO_PLACEHOLDER}“ und leerem html. Du schreibst keinen echten Hero; Schritt 5 füllt ihn.
3. Abschnitt id „zusammenfassung“ (H2, z. B. „Das Wichtigste in Kürze“ oder die main_question als Frage): 60–80 Wörter, beantwortet die main_question direkt im ersten Satz, enthält 3–4 belegte Fakten, taugt als Snippet.
4. Abschnitt id „einleitung“ (H2): 100–150 Wörter Einstieg aus Sicht des Avatars (sein Anliegen, was ihn hier erwartet).
5. Danach H2/H3 im Wechsel aus Frage-Überschriften (aus fanout_questions, Spalte H zuerst, als echte Frage formuliert) und beschreibenden Überschriften. Die ersten 1–2 Sätze unter einer Frage-Überschrift beantworten die Frage direkt. Kein FAQ-Block am Ende: die Fragen SIND die Überschriften. Mindestens ${minQuestions} Frage-Überschriften.
6. ${
      page.page_type === "ratgeber"
        ? "Zum Schluss ein weicher nächster Schritt (Abschnitt id „naechster-schritt“): weiterlesen, unverbindlich fragen – ohne Dringlichkeit, nur Kontaktwege aus den Fakten."
        : "Handlungsaufforderung am Ende (Abschnitt id „kontakt“): nur Kontaktwege, die in den Fakten stehen. Schritt 5 schärft sie."
    }

Regeln:
- Hauptkeyword in H1, Zusammenfassung und mindestens einer Abschnittsüberschrift; Nebenkeywords natürlich verteilt, keine Wiederholung um ihrer selbst willen.
- deferred_questions werden nicht beantwortet, sondern in einem Satz mit [LINK: Seitenname] auf die zuständige Seite verwiesen.
- Lokale Seiten: echter lokaler Bezug aus den Fakten (Einzugsgebiet, Anfahrt, Besonderheiten), den Ortsnamen nicht stapeln.
- Fehlende Preise, Zahlen, Fristen, Namen: Platzhalter [BITTE PRÜFEN: was genau fehlt] statt erfinden.
- Interne Links nur auf die erlaubten Linkziele, als Marker [LINK: Seitenname] im Fließtext; keine <a>-Tags, keine erfundenen Ziele.
- „Wir von ${context.organisationName || "[Firmenname]"}“ 1–2-mal im Text; sonst Firmenname und „unser Team“ abwechseln.
- Länge: so lang, wie die belegten Fakten tragen, typisch 700–1.400 Wörter. Kein Füllmaterial, konkrete Sätze statt Allgemeinplätze.
- title: Title-Tag mit Hauptkeyword, max. 60 Zeichen. meta_description: max. 155 Zeichen, Nutzen plus Hauptkeyword.
${brancheRules(context.settings)}`,
    user: join([
      pageBlock(context),
      outputBlock(context, CONTENT_STEP_ANALYSE, "Analyse (Schritt 1)"),
      anbieterBlock(context),
      settingsBlock(context.settings),
      avatarBlock(context),
      notesBlock(context),
    ]),
    tool: {
      name: "submit_seo_text",
      description: "Der vollständige Seitentext in Abschnitten, mit Title und Meta-Description.",
      input_schema: TEXT_TOOL_SCHEMA,
    },
    normalize: (json, ctx): TextOutput => {
      const out = normalizeTextOutput(json, ctx);
      return { ...out, blocks: ensureHeroPlaceholder(out.blocks) };
    },
  };
}

function faktencheck(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: 6_000,
    system: `${BASE_RULES}

Schritt 3 Faktencheck: Du prüfst jeden Satz des aktuellen Texts gegen die Anbieterfakten und die Anmerkungen der Redaktion.
Ein finding ist jede Aussage, die nicht belegt ist, den Fakten widerspricht, eine erfundene oder gerundete Zahl enthält, ein verbotenes Wort enthält, die Anrede bricht, einen unbelegten Superlativ oder ein Versprechen macht oder gegen die Branchenregel verstößt. severity high = falsch oder rechtlich riskant, medium = unbelegt, low = unscharf. Der Platzhalter „${CONTENT_HERO_PLACEHOLDER}“ ist gewollt und kein Befund; [LINK: …]-Marker sind gewollt.
Eine question stellst du nur, wenn allein der Kunde die Antwort kennt (Zahl stimmt? Leistung wird angeboten? Kontaktweg? Preis für den Platzhalter?). Jeder Platzhalter [BITTE PRÜFEN: …] im Text wird eine question mit kind „missing“. blocking = true, wenn der Text ohne Antwort nicht veröffentlicht werden darf. Was du selbst durch Streichen lösen kannst, ist keine Frage, sondern ein finding mit Vorschlag.
Beantwortet eine Anmerkung der Redaktion eine Frage bereits, stellst du sie nicht noch einmal.
${brancheRules(context.settings)}`,
    user: join([
      pageBlock(context),
      currentTextBlock(context),
      anbieterBlock(context),
      settingsBlock(context.settings),
      avatarBlock(context),
      notesBlock(context),
    ]),
    tool: {
      name: "submit_faktencheck",
      description: "Befunde und Fragen an den Kunden.",
      input_schema: {
        type: "object",
        properties: {
          findings: FINDINGS_SCHEMA,
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["fact", "decision", "missing"] },
                question: { type: "string" },
                field: { type: "string", description: "Betroffener Anbieter-Abschnitt (z. B. beweise, preis), oder leer." },
                placeholder: { type: "string", description: "Beispiel für eine Antwort." },
                block_id: { type: "string" },
                excerpt: { type: "string", description: "Der Satz aus dem Text, um den es geht." },
                blocking: { type: "boolean" },
              },
              required: ["kind", "question", "field", "placeholder", "block_id", "excerpt", "blocking"],
            },
          },
        },
        required: ["findings", "questions"],
      },
    },
    normalize: (json, ctx): FaktencheckOutput => {
      const r = rec(json);
      const ids = blockIds(ctx.blocks);
      return { findings: normalizeFindings(r.findings, ids), questions: normalizeQuestions(r.questions, ids) };
    },
  };
}

function geo(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: 12_000,
    system: `${BASE_RULES}

Schritt 4 GEO (Generative Engine Optimization): Du überarbeitest den Text so, dass KI-Suchsysteme ihn verstehen und zitieren können. Du erfindest keine Fakten und fügst keine hinzu.
Zuerst setzt du die Befunde des Faktenchecks um: Unbelegtes streichen oder durch [BITTE PRÜFEN: …] ersetzen; offene Fragen so umschreiben, dass der Text ohne die Antwort auskommt. Antworten in den Anmerkungen der Redaktion sind bestätigte Fakten und werden eingearbeitet.
Dann:
- Die Kernantwort steht in den ersten 100–150 Wörtern (Zusammenfassung und Einleitung). Ankündigungen wie „In diesem Artikel erfahren Sie …“ streichen.
- fanout_questions aus der Analyse, die der Text noch nicht beantwortet, beantworten: als Frage-Überschrift mit Antwort oder als Satz in einem passenden Abschnitt. deferred_questions nur mit Verweis [LINK: Seitenname].
- Jeder Abschnitt 120–180 Wörter und für sich allein verständlich; keine Verweise wie „wie oben erwähnt“. Der erste Satz eines Abschnitts nennt das Thema ausdrücklich.
- Entitäten: Firmenname, Ort (nur aus den Fakten) und Kernleistung stehen ausgeschrieben im Text; bei Kernfakten den Firmennamen nennen, nicht nur „wir“.
- Rechtliches, Medizinisches, Fristen und Zahlen brauchen eine Quelle aus den Fakten oder den Marker [QUELLE BITTE ERGÄNZEN].
- Als letzter Abschnitt id „stand“ ohne Überschrift: „Zuletzt aktualisiert: [DATUM]“ als <p>.
${KEEP_RULES} Title und Meta-Description nur ändern, wenn der Faktencheck es verlangt.
${brancheRules(context.settings)}`,
    user: join([
      pageBlock(context),
      currentTextBlock(context),
      outputBlock(context, CONTENT_STEP_ANALYSE, "Analyse (Schritt 1) – Fragen, die der Text abdecken muss"),
      outputBlock(context, CONTENT_STEP_FAKTENCHECK, "Faktencheck (Schritt 3) – umsetzen"),
      anbieterBlock(context),
      settingsBlock(context.settings),
      avatarBlock(context),
      notesBlock(context),
    ]),
    tool: {
      name: "submit_geo_text",
      description: "Der für KI-Zitate überarbeitete Seitentext in Abschnitten.",
      input_schema: TEXT_TOOL_SCHEMA,
    },
    normalize: (json, ctx): TextOutput => {
      const out = normalizeTextOutput(json, ctx);
      return { ...out, blocks: keepHeroBlock(out.blocks, ctx.blocks) };
    },
  };
}

function hormozi(context: ContentPipelineContext): ContentStepSpec {
  const ratgeber = context.page.page_type === "ratgeber";
  return {
    maxTokens: 12_000,
    system: `${BASE_RULES}

Schritt 5 Hormozi (Conversion-Schicht): Du machst den Text überzeugend, ohne die SEO- und GEO-Struktur zu ersetzen.
- Hero: Der Abschnitt „hero“ bekommt statt des Platzhalters genau EINEN Satz – das Traumergebnis oder der gelöste Hauptschmerz des Avatars (hormozi.traumziel / hormozi.hauptschmerz aus der Analyse), in der bestätigten Anrede. heading bleibt leer, der Satz steht als <p>. Die H1 bleibt unverändert.
- Value Equation nur aus hormozi der Analyse und den Anbieterfakten: Traumergebnis, Erfolgswahrscheinlichkeit (nur mit echten, belegten Beweisen – sonst weglassen), Zeit bis zum Ergebnis, Aufwand für den Kunden. In die bestehenden Abschnitte einweben; keine neuen Überschriftenebenen, keine neuen Abschnitte.
- Handlungsaufforderungen: konkretes Angebot plus Grund, jetzt zu handeln, mit den Kontaktwegen aus den Fakten. Verknappung, Garantien und Fristen nur, wenn sie in den Anbieterfakten stehen.
${
  ratgeber
    ? "- Ratgeberartikel: Problem–Lösung-Zyklus, am Ende ein weicher nächster Schritt (weiterlesen, unverbindlich fragen). Kein harter Verkauf, keine Dringlichkeit."
    : "- Jede Handlungsaufforderung nennt, was der Leser bekommt und was der nächste Schritt ist."
}
- Keine Erfolgsversprechen, keine unbelegten Superlative, keine erfundenen Zahlen oder Referenzen.
${KEEP_RULES} Überschriftenebenen bleiben, Title und Meta-Description bleiben.
${brancheRules(context.settings)}`,
    user: join([
      pageBlock(context),
      currentTextBlock(context),
      outputBlock(context, CONTENT_STEP_ANALYSE, "Analyse (Schritt 1) – hormozi, conversion_goal und usable_facts"),
      anbieterBlock(context),
      settingsBlock(context.settings),
      avatarBlock(context),
      notesBlock(context),
    ]),
    tool: {
      name: "submit_hormozi_text",
      description: "Der Seitentext mit Hero-Satz, Value Equation und geschärften Handlungsaufforderungen.",
      input_schema: TEXT_TOOL_SCHEMA,
    },
    normalize: (json, ctx): TextOutput => {
      const out = normalizeTextOutput(json, ctx);
      return { ...out, blocks: settleHeroSentence(keepHeroBlock(out.blocks, ctx.blocks)) };
    },
  };
}

const SELF_SCORE_KEYS = ["direktheit", "rhythmus", "vertrauen", "natuerlichkeit", "dichte"] as const;

export function selfScoreSum(score: SelfScore | null | undefined): number | null {
  if (!score) return null;
  return SELF_SCORE_KEYS.reduce((sum, key) => sum + score[key], 0);
}

function normalizeSelfScore(raw: unknown): SelfScore | null {
  const r = rec(raw);
  const out: Partial<SelfScore> = {};
  for (const key of SELF_SCORE_KEYS) {
    const n = Number(r[key]);
    if (!Number.isFinite(n)) return null;
    out[key] = Math.max(1, Math.min(10, Math.round(n)));
  }
  return out as SelfScore;
}

function vermenschlichung(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: 12_000,
    system: `${BASE_RULES}

Schritt 6 Vermenschlichung: Du änderst nur die Formulierung – nicht Inhalt, Struktur, Reihenfolge oder Fakten.
- Sätze höchstens etwa 20 Wörter, Sprachniveau B2, aktiv, Verben statt Substantivketten, keine Füllwörter.
- Den Leser mit der bestätigten Anrede ansprechen; Überschriften bleiben neutral (kein „Ich“, kein „Wir“ in Überschriften).
- KI-Muster entfernen: Dreierlisten als Reflex, „nicht X, sondern Y“, „Doch was bedeutet das konkret?“, gleichförmiger Satzrhythmus, vages „Die Gründe sind vielfältig“, absolute „immer/jeder/nie“ ohne Beleg, fette Mini-Überschriften mitten im Absatz.
- Gedankenstriche so wenig wie möglich; höchstens 3 im ganzen Text, wenn er unter etwa 1.500 Wörter hat.
- Gesperrte Floskeln (ersetzen oder streichen): ${CONTENT_FLOSKELN.map((f) => `„${f}“`).join(", ")}. Füllwörter ${CONTENT_FUELLWOERTER.join(", ")} streichen, wenn sie nichts tragen.
- Keine erfundenen Ich-Geschichten, keine neuen Fakten, keine neuen Zahlen.
${KEEP_RULES} Der Hero-Satz bleibt ein Satz. Title und Meta-Description bleiben.
self_score: Bewerte den fertigen Text ehrlich von 1 bis 10 in direktheit (sagt sofort, was Sache ist), rhythmus (Satzlängen wechseln), vertrauen (belegt statt behauptet), natuerlichkeit (klingt nach Mensch), dichte (kein Satz ohne Inhalt).
${brancheRules(context.settings)}`,
    user: join([
      pageBlock(context),
      currentTextBlock(context),
      anbieterBlock(context),
      settingsBlock(context.settings),
      avatarBlock(context),
      notesBlock(context),
    ]),
    tool: {
      name: "submit_vermenschlichung_text",
      description: "Der sprachlich überarbeitete Seitentext in Abschnitten mit Selbstbewertung.",
      input_schema: {
        type: "object",
        properties: {
          ...TEXT_PROPERTIES,
          self_score: {
            type: "object",
            properties: Object.fromEntries(SELF_SCORE_KEYS.map((key) => [key, { type: "integer", minimum: 1, maximum: 10 }])),
            required: [...SELF_SCORE_KEYS],
          },
        },
        required: ["title", "meta_description", "blocks", "self_score"],
      },
    },
    normalize: (json, ctx): VermenschlichungOutput => {
      const out = normalizeTextOutput(json, ctx);
      return {
        ...out,
        blocks: keepHeroBlock(out.blocks, ctx.blocks),
        self_score: normalizeSelfScore(rec(json).self_score),
      };
    },
    retryHint: (output) => {
      const out = output as VermenschlichungOutput;
      const sum = selfScoreSum(out.self_score);
      if (sum == null || sum >= CONTENT_SELF_SCORE_MIN) return null;
      const detail = SELF_SCORE_KEYS.map((key) => `${key} ${out.self_score![key]}`).join(", ");
      return [
        "## Zweiter Versuch",
        `Der erste Versuch bewertete sich selbst mit ${sum} von 50 (${detail}). Das reicht nicht. Nimm den folgenden ersten Versuch als Ausgangspunkt und überarbeite ihn gründlicher nach denselben Regeln: kürzere Sätze, aktiver, konkreter, keine Floskeln, wechselnder Rhythmus. Fakten, Struktur, ids, Keywords, Platzhalter und Marker bleiben.`,
        blocksToPromptText(out.blocks),
      ].join("\n");
    },
    score: (output) => selfScoreSum((output as VermenschlichungOutput).self_score) ?? 0,
  };
}

function lektorat(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: 12_000,
    system: `${BASE_RULES}

Schritt 7 Lektorat: Du korrigierst Rechtschreibung, Grammatik, Zeichensetzung und Satzbau. Du glättest Wiederholungen und Füllwörter. Du änderst keine Fakten, keine Struktur und keine Reihenfolge; ids bleiben.
Prüfe noch einmal: Anrede durchgehend, kein verbotenes Wort, Tonalität getroffen, Branchenregel eingehalten, Frage-Überschriften noch Fragen, Hauptkeyword in H1 und Zusammenfassung. Was du nicht selbst beheben darfst (fehlende Fakten, offene Entscheidungen, stehengebliebene Platzhalter, ein nicht gefüllter Hero), meldest du als final_findings.
${KEEP_RULES}
${brancheRules(context.settings)}`,
    user: join([
      pageBlock(context),
      currentTextBlock(context),
      anbieterBlock(context),
      settingsBlock(context.settings),
      avatarBlock(context),
      notesBlock(context),
    ]),
    tool: {
      name: "submit_lektorat",
      description: "Korrigierter Text und verbleibende Befunde.",
      input_schema: {
        type: "object",
        properties: {
          ...TEXT_PROPERTIES,
          final_findings: FINDINGS_SCHEMA,
        },
        required: ["title", "meta_description", "blocks", "final_findings"],
      },
    },
    normalize: (json, ctx): LektoratOutput => {
      const out = normalizeTextOutput(json, ctx);
      const blocks = keepHeroBlock(out.blocks, ctx.blocks);
      return { ...out, blocks, final_findings: normalizeFindings(rec(json).final_findings, blockIds(blocks)) };
    },
  };
}

function endabnahme(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: 3_000,
    system: `${BASE_RULES}

Schritt 9 Endabnahme: Du bist die letzte Kontrolle vor der Freigabe durch einen Menschen. Du änderst nichts mehr.
unresolved: alles, was die Freigabe noch verhindern könnte – unbelegte Zahl, rechtliches Risiko, fehlender Kontaktweg, verbotenes Wort, Anredebruch, ein stehengebliebener Platzhalter [BITTE PRÜFEN: …] oder [QUELLE BITTE ERGÄNZEN], ein nicht gefüllter Hero („${CONTENT_HERO_PLACEHOLDER}“), eine fehlende Verlinkung auf das Hauptsilo bei einer Unterseite. Leer, wenn der Text freigegeben werden kann. Gewollt und kein Befund: [LINK: …]-Marker (setzt das Web-Team) und „Zuletzt aktualisiert: [DATUM]“.
summary: 2–3 Sätze für die Redaktion: Was die Seite leistet, worauf beim Freigeben zu achten ist.`,
    user: join([
      pageBlock(context),
      currentTextBlock(context),
      outputBlock(context, CONTENT_STEP_LEKTORAT, "Lektorat (Schritt 7) – gemeldete Befunde"),
      anbieterBlock(context),
      settingsBlock(context.settings),
      avatarBlock(context),
      notesBlock(context),
    ]),
    tool: {
      name: "submit_endabnahme",
      description: "Offene Punkte und Zusammenfassung für die Freigabe.",
      input_schema: {
        type: "object",
        properties: {
          unresolved: FINDINGS_SCHEMA,
          summary: { type: "string" },
        },
        required: ["unresolved", "summary"],
      },
    },
    normalize: (json, ctx): EndabnahmeOutput => {
      const r = rec(json);
      return { unresolved: normalizeFindings(r.unresolved, blockIds(ctx.blocks)), summary: str(r.summary, 1_000) };
    },
  };
}

// --- step 8: every sentence rephrased, on Grok ------------------------------------------------

/**
 * Step 8 runs on Grok (xAI, see `xai.ts`), not on Claude. The prompt describes a plain
 * language pass over the finished text; the step's UI name stays out of it on purpose,
 * since the model refuses some framings. Facts, headings, ids and markers are not the
 * model's to change, and `mergeRewrittenBlocks` enforces that afterwards.
 */
const REPHRASE_SYSTEM = `Du überarbeitest den fertigen Seitentext sprachlich.
Schreibe jeden Satz neu. Kopiere keinen Satz wörtlich.
Behalte unverändert: HTML-Blöcke und ids, H1, alle Überschriften (auch Fragen-Überschriften), alle Fakten, Namen, Zahlen, [LINK: …], [BITTE PRÜFEN: …], [DATUM], Handlungsaufforderungen (Termin, Telefon, DrFlex).
Natürliches Deutsch: Satzlängen mischen, keine Werbe-Floskeln (Endlich, wirklich, nicht nur eine Floskel, sprechen eine klare Sprache, Machen Sie noch heute den ersten Schritt).
Erfinde nichts. Keine neuen Leistungen, Zahlen oder Bewertungen.
Anrede, Tonalität und verbotene Wörter aus den Vorgaben gelten weiter.
Antworte mit dem Werkzeug submit_text: dieselben Abschnitte in derselben Reihenfolge, mit denselben ids, headings und levels; nur das html jedes Abschnitts ist neu formuliert.`;

/**
 * The rephrased blocks over the previous ones: ids, headings, levels and order come from the
 * previous text (a question heading stays a question, a dropped block comes back), only the
 * body HTML is taken from the answer. Blocks are matched by id, or by position when the
 * answer renamed them but kept the count.
 */
export function mergeRewrittenBlocks(previous: readonly ContentTextBlock[], output: readonly ContentTextBlock[]): ContentTextBlock[] {
  if (previous.length === 0) return [...output];
  const byId = new Map(output.map((b) => [b.id, b]));
  const positional = output.length === previous.length;
  return previous.map((prev, index) => {
    const candidate = byId.get(prev.id) ?? (positional ? output[index] : undefined);
    const html = candidate?.html.trim() ? candidate.html : prev.html;
    return { ...prev, html };
  });
}

function rephrase(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: 12_000,
    system: REPHRASE_SYSTEM,
    user: join([currentTextBlock(context), settingsBlock(context.settings), notesBlock(context)]),
    tool: {
      name: "submit_text",
      description: "Die sprachlich überarbeiteten Abschnitte, in derselben Reihenfolge mit denselben ids.",
      input_schema: {
        type: "object",
        properties: { blocks: BLOCKS_SCHEMA },
        required: ["blocks"],
      },
    },
    normalize: (json, ctx): TextOutput => {
      const answered = normalizeBlocks(rec(json).blocks);
      if (answered.length === 0) throw new Error("Die Antwort enthielt keinen Text.");
      return { blocks: mergeRewrittenBlocks(ctx.blocks, answered), title: ctx.title, meta_description: ctx.metaDescription };
    },
  };
}

const SPECS: Record<number, (context: ContentPipelineContext) => ContentStepSpec> = {
  1: analyse,
  2: seo,
  3: faktencheck,
  4: geo,
  5: hormozi,
  6: vermenschlichung,
  7: lektorat,
  8: rephrase,
  9: endabnahme,
};

export function contentStepSpec(step: number, context: ContentPipelineContext): ContentStepSpec {
  const build = SPECS[step];
  if (!build) throw new Error(`Unbekannter Schritt ${step}.`);
  return build(context);
}
