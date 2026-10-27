/**
 * Prompts, tool schemas and output normalisation for the steps, ported from the rules of the
 * old Step-by-Step-Content-Agent (step1_analyse … step5_vermenschlichung). The
 * Aktualitätsprüfung (two calls, web search) has its own module, `aktualitaet.ts`, built from
 * the helpers exported here. Pure: no Supabase, no Anthropic client. `run-step.ts` wires them
 * to the model.
 *
 * Every step receives the same context blocks: the page with its Excel briefing, the
 * Anbieterfakten (only source of facts), the confirmed settings (Anrede, Branche,
 * Tonalität, verbotene Wörter), the avatar and the editor's notes.
 */

import type Anthropic from "@anthropic-ai/sdk";

import type { ContentPageKeywords } from "@/lib/dt/content/excel-structure";
import {
  brancheRuleGroup,
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
import { REPHRASE_SYSTEM, rephraseChunkHtml } from "@/lib/dt/content/pipeline/rephrase";
import {
  CONTENT_STEP_AKTUALITAET,
  CONTENT_STEP_ANALYSE,
  CONTENT_STEP_ENDABNAHME,
  CONTENT_STEP_FAKTENCHECK,
  CONTENT_STEP_GEO,
  CONTENT_STEP_HORMOZI,
  CONTENT_STEP_LEKTORAT,
  CONTENT_STEP_SEO,
  CONTENT_STEP_VERMENSCHLICHUNG,
  CONTENT_STEP_WATERMARK,
} from "@/lib/dt/content/pipeline/steps";
import { blocksToPromptText, escapeHtml, htmlToPlainText, normalizeBlocks, type ContentTextBlock } from "@/lib/dt/content/render";
import {
  CONTENT_FLOSKELN,
  CONTENT_FUELLWOERTER,
  CONTENT_HERO_PLACEHOLDER,
  CONTENT_HERO_PLACEHOLDER_LEGACY,
  KEEP_RULES,
  fillContentStepPrompt,
  resolveContentStepPrompt,
  type ContentStepPromptKey,
  type ContentStepPrompts,
} from "@/lib/dt/content/step-prompts";
import { DEFAULT_TEXTER_PROMPT } from "@/lib/dt/content/texter-prompt";
import { renderContentTypePrompt, type ContentTypePrompts } from "@/lib/dt/content/type-prompts";
import type { ContentFinding, ContentFreshness, ContentPageSource, ContentQuestion } from "@/lib/dt/content/types";

/**
 * Where a page of the prompt comes from: the Excel structure, the crawl, or — only in the
 * standalone SEO and Hormozi tools (lib/dt/text-tools/seo.ts, hormozi.ts) — an upload with
 * a form. The third value never reaches `dt_content_pages`; it is a prompt-time label.
 */
export type ContentPipelinePageSource = ContentPageSource | "standalone";

export type ContentPipelinePage = {
  name: string;
  path: string | null;
  level: number;
  url?: string | null;
  source: ContentPipelinePageSource;
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
  /**
   * Current text of the live page for pages taken over from the crawl; for a standalone
   * page the uploaded material (briefing or old text); null otherwise.
   */
  existingText: string | null;
  sections: WorkshopAnbieterSection[];
  settings: ContentTextSettings;
  avatar: { name: string; role: string; beschreibung: string } | null;
  /** The agency's writing recipes per page type („Textvorlagen“); only the SEO step reads them. */
  typePrompts: ContentTypePrompts;
  /**
   * General rules for every page type (Globale Prompts → Texter). Only the SEO step reads
   * them; a missing value means the code default.
   */
  texterPrompt?: string;
  /**
   * The editable step instructions (Globale Prompts → SEO … Lektorat). A missing or empty
   * one means the built-in default; the locked rules and the tool schema are added in code.
   */
  stepPrompts?: Partial<ContentStepPrompts>;
  /** Human notes from "Mit Anmerkung wiederholen", oldest first. */
  notes: string[];
  /**
   * The Aktualitätsprüfung's state on this page (`dt_content_pages.freshness`). GEO reads its
   * `pending_sections` after a send-back; the standalone tools have none.
   */
  freshness?: ContentFreshness;
  /** Open points on the page (`dt_content_pages.findings`); the Endabnahme lists the ones still open. */
  openFindings?: ContentFinding[];
  /** Normalised outputs of earlier steps, by step number. */
  outputs: Partial<Record<number, unknown>>;
  /** Current text (page HTML parsed into blocks); empty before the SEO step. */
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

// Defined with the editable step defaults (step-prompts.ts), which quote them; kept importable from here.
export { CONTENT_FLOSKELN, CONTENT_FUELLWOERTER, CONTENT_HERO_PLACEHOLDER, CONTENT_HERO_PLACEHOLDER_LEGACY, KEEP_RULES };
export const CONTENT_HERO_BLOCK_ID = "hero";
/** Sum of the five self-scores (1–10 each) under which the Vermenschlichung tries once more. */
export const CONTENT_SELF_SCORE_MIN = 35;

const MAX_SECTION_CHARS = 6_000;
/** The avatar's description (`avatarTextForContent`); fits nine in ten avatar texts whole. */
const MAX_AVATAR_CHARS = 20_000;
const MAX_OUTLINE_CHARS = 5_000;
const MAX_EXISTING_TEXT_CHARS = 6_000;
/** An upload in the standalone SEO tool is the whole briefing, so it may be longer than a crawl excerpt. */
export const MAX_STANDALONE_MATERIAL_CHARS = 30_000;
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
      kind: ["fact", "decision", "missing", "outdated"].includes(String(r.kind)) ? String(r.kind) : "fact",
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

/** The text a rewriting step starts from; the whole pipeline context or the GEO tool's. */
export type ContentCurrentText = Pick<ContentPipelineContext, "blocks" | "title" | "metaDescription">;

export function normalizeTextOutput(json: unknown, context: ContentCurrentText): TextOutput {
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

/**
 * The hero section as the SEO step leaves it: nothing but the placeholder (either spelling,
 * in the heading or the body). A hero Hormozi filled, or one an editor wrote into, is not.
 */
export function isEmptyHeroPlaceholder(block: ContentTextBlock | null | undefined): boolean {
  if (!block) return false;
  const text = `${block.heading ?? ""} ${htmlToPlainText(block.html)}`.replace(/\s+/g, " ").trim();
  return /^\[\s*HERO\b[^\]]*\]$/i.test(text);
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
// Exported for the standalone GEO and Hormozi tools (lib/dt/text-tools/geo.ts, hormozi.ts),
// which build the same blocks around an uploaded text instead of a page of the pipeline.

export function anbieterBlock(context: Pick<ContentPipelineContext, "sections">): string {
  const filled = context.sections.filter((s) => s.current.trim());
  if (filled.length === 0) return "## Anbieterfakten\n(keine)";
  return [
    "## Anbieterfakten aus Fragebogen und Kundengesprächen (einzige Quelle für Tatsachen)",
    ...filled.map((s) => `### ${s.label}\n${clip(s.current, MAX_SECTION_CHARS)}`),
  ].join("\n\n");
}

export function settingsBlock(settings: ContentTextSettings): string {
  const forbidden = settings.verbotene_woerter.length
    ? settings.verbotene_woerter.map((w) => `„${w}“`).join(", ")
    : "keine";
  return [
    "## Vorgaben",
    `Anrede: ${settings.anrede === "Du" ? "Du (Leser werden geduzt)" : "Sie (Leser werden gesiezt)"}`,
    `Branche: ${settings.branche || "nicht angegeben"}`,
    `Tonalität: ${contentTonalitaetText(settings.tonalitaet)}`,
    `Verbotene Wörter (dürfen nirgends vorkommen, auch nicht in Überschriften): ${forbidden}`,
  ].join("\n");
}

/** The free-text branch picks one of three rule groups; the text itself is in the Vorgaben block. */
export function brancheRules(settings: ContentTextSettings): string {
  switch (brancheRuleGroup(settings.branche)) {
    case "rechtsanwalt":
      return "Branchenregel Kanzlei: keine Erfolgsversprechen, keine Garantien zum Ausgang eines Verfahrens, keine Superlative wie „der beste Anwalt“. Fachgebiete nur nennen, wenn sie in den Anbieterfakten stehen.";
    case "arzt":
      return "Branchenregel Praxis (Heilmittelwerbegesetz): keine Heilversprechen, keine Erfolgsquoten, keine Vorher-nachher-Vergleiche, keine Angst machenden Formulierungen. Behandlungen nur nennen, wenn sie in den Anbieterfakten stehen.";
    default:
      return "Branchenregel Dienstleistung & Handwerk: Preise, Fristen und Garantien nur so, wie sie in den Anbieterfakten stehen. Keine erfundenen Referenzen oder Zahlen.";
  }
}

export function avatarBlock(context: Pick<ContentPipelineContext, "avatar">): string {
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

/** Which briefing the page's keywords, H1 options and questions come from, as the prompt names it. */
function briefingLabel(page: Pick<ContentPipelinePage, "source">): string {
  return page.source === "standalone" ? "aus dem Briefing" : "aus der Excel";
}

function sourceLine(page: ContentPipelinePage): string {
  if (page.source === "structure") return "Excel-Seitenstruktur (Briefing der Redaktion)";
  // A crawl page that a Seitenstruktur matched („Verbesserung“): only the Excel sets a role.
  if (page.source === "crawl" && page.page_role) {
    return "Bestehende Website (Crawl) mit Briefing aus der Excel-Seitenstruktur";
  }
  if (page.source === "standalone") {
    return "eigenständiges SEO-Werkzeug (Briefing-Formular und ggf. hochgeladenes Material; keine Seitenstruktur, keine anderen Seiten bekannt)";
  }
  return "Crawl der bestehenden Website (kein Briefing, Keywords und Fragen werden hier erarbeitet)";
}

export function pageBlock(context: ContentPipelineContext): string {
  const { page } = context;
  const standalone = page.source === "standalone";
  const briefing = briefingLabel(page);
  const lines = [
    "## Seite",
    `Organisation: ${context.organisationName}`,
    `Seite: ${page.name}`,
    page.path ? `Pfad: ${page.path}` : "",
    page.url ? `Live-URL: ${page.url}` : "",
    `Quelle: ${sourceLine(page)}`,
    `Rolle in der Struktur: ${page.page_role ? CONTENT_PAGE_ROLE_LABELS[page.page_role] : standalone ? "keine (eigenständige Seite)" : "keine (Crawl-Seite)"} · Ebene ${page.level} (0 = Startseite)`,
    `Seitentyp: ${CONTENT_PAGE_TYPE_LABELS[page.page_type]}`,
    page.pillar_name ? `Hauptsilo (übergeordnete Seite): ${page.pillar_name}` : "",
    page.estimated_traffic != null ? `Geschätzter Traffic laut Excel: ${page.estimated_traffic}` : "",
    page.keywords
      ? `Hauptkeyword ${briefing} (gesetzt, nicht ersetzen): ${keywordText(page.keywords.main)}`
      : "Hauptkeyword: nicht vorgegeben",
    page.keywords && page.keywords.secondary.length > 0
      ? `Nebenkeywords ${briefing}: ${page.keywords.secondary.map(keywordText).join(", ")}`
      : "",
    page.h1_options.length > 0 ? `H1-Optionen ${briefing}:\n${list(page.h1_options)}` : "",
    page.user_questions.length > 0
      ? `Nutzerfragen ${standalone ? "aus dem Briefing (zählen wie Spalte H: echte Google-Fragen" : "aus Spalte H (echte Google-Fragen"}, haben Vorrang vor erfundenen Fragen):\n${list(page.user_questions)}`
      : "",
    page.ki_prompt ? `KI-Prompt der Redaktion für diese Seite (stehende Anweisung):\n${clip(page.ki_prompt, 2_000)}` : "",
    page.internal_link_targets.length > 0
      ? `Erlaubte interne Linkziele (nur diese, als Marker [LINK: Seitenname]): ${page.internal_link_targets.join(" · ")}`
      : "Erlaubte interne Linkziele: keine bekannt – keine internen Links setzen",
    context.structureOutline
      ? `\n## Weitere Seiten der Website (zur Abgrenzung: welche Fragen gehören auf eine andere Seite; keine Fakten)\n${clip(context.structureOutline, MAX_OUTLINE_CHARS)}`
      : "",
    context.existingText
      ? standalone
        ? `\n## Hochgeladenes Material (Briefing oder bisheriger Text, nur zur Orientierung)\nThema, Umfang, Begriffe, Aufbau. Fakten daraus gelten nur, wenn sie auch in den Anbieterfakten oder den Anmerkungen der Redaktion stehen – sonst sind sie unbelegt und bekommen [BITTE PRÜFEN: …].\n${clip(context.existingText, MAX_STANDALONE_MATERIAL_CHARS)}`
        : `\n## Bisheriger Text der Seite (Live-Website, nur zur Orientierung)\nSo liest sich die Seite heute: Thema, Umfang, Begriffe. Fakten daraus gelten nur, wenn sie auch in den Anbieterfakten stehen – sonst sind sie unbelegt.\n${clip(context.existingText, MAX_EXISTING_TEXT_CHARS)}`
      : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function formatNotes(notes: readonly string[]): string {
  if (notes.length === 0) return "";
  return [
    "## Anmerkungen der Redaktion (gelten vor allem anderen; Antworten darin sind bestätigte Fakten)",
    ...notes.map((n, i) => `${i + 1}. ${n}`),
  ].join("\n");
}

/** The editor's notes as a numbered list (each clipped); empty string without notes. */
export function editorNotesBlock(notes: readonly string[]): string {
  return formatNotes(notes.map((n) => clip(n, 2_000)).filter(Boolean));
}

/**
 * What the notes block and the step-8 chunk prompt need: the Vorgaben, the editor's notes
 * and, for a page of the pipeline, the KI-Prompt of the structure. The standalone
 * Watermark tool (lib/dt/text-tools/watermark.ts) belongs to no organisation: it passes no
 * settings and no notes, and the prompt then keeps the text's own form of address and tone.
 */
export type RephrasePromptContext = {
  settings?: ContentTextSettings | null;
  notes: readonly string[];
  page?: { ki_prompt: string | null } | null;
};

/** The Vorgaben of a text without Texte settings: whatever the text already does stays. */
export const REPHRASE_OWN_VORGABEN = [
  "## Vorgaben",
  "Anrede (Sie oder Du) und Tonalität wie im gelieferten Text beibehalten.",
].join("\n");

export function notesBlock(context: RephrasePromptContext): string {
  return formatNotes([
    ...(context.page?.ki_prompt ? [`KI-Prompt aus der Seitenstruktur: ${clip(context.page.ki_prompt, 2_000)}`] : []),
    ...context.notes.map((n) => clip(n, 2_000)),
  ]);
}

function outputBlock(context: ContentPipelineContext, step: number, title: string, max = MAX_OUTPUT_CHARS): string {
  const output = context.outputs[step];
  if (!output) return "";
  return `## ${title}\n${JSON.stringify(output, null, 1).slice(0, max)}`;
}

export function currentTextBlock(context: ContentCurrentText): string {
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

/** Prompt blocks separated by a blank line; empty blocks (optional parts) fall out. */
export function joinPromptParts(parts: readonly string[]): string {
  return parts.filter(Boolean).join("\n\n");
}

const join = joinPromptParts;

export const BASE_RULES = `Du arbeitest für eine Agentur, die Webseitentexte für kleine Unternehmen schreibt. Sprache: Deutsch.
Tatsachen (Leistungen, Zahlen, Namen, Preise, Abläufe, Orte) kommen ausschließlich aus den Anbieterfakten und den Anmerkungen der Redaktion. Nichts erfinden, nichts aus Branchenwissen ergänzen. Fehlt eine Angabe, bleibt sie weg oder wird als offene Frage gemeldet.
Anrede, Tonalität und verbotene Wörter aus den Vorgaben gelten ohne Ausnahme.`;

export const BLOCKS_SCHEMA = {
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

export const TEXT_PROPERTIES = {
  title: { type: "string", description: "Title-Tag, max. 60 Zeichen. Leer lassen, wenn unverändert." },
  meta_description: { type: "string", description: "Meta-Description, max. 155 Zeichen. Leer lassen, wenn unverändert." },
  blocks: BLOCKS_SCHEMA,
};

export const TEXT_TOOL_SCHEMA: Anthropic.Tool["input_schema"] = {
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

// --- editable step instructions ----------------------------------------------------------------

/**
 * What `{{…}}` in a step instruction stands for on this page. The standalone tools pass their
 * own page (GEO: none, so not a Ratgeber and „aus dem Briefing“).
 */
export function contentStepPromptVariables(context: {
  organisationName: string;
  page: Pick<ContentPipelinePage, "source" | "page_type"> | null;
}): Record<string, string> {
  const ratgeber = context.page?.page_type === "ratgeber";
  return {
    briefing: context.page ? briefingLabel(context.page) : "aus dem Briefing",
    mindest_fragen: ratgeber ? "5" : "3",
    abschluss: ratgeber
      ? "Zum Schluss ein weicher nächster Schritt (Abschnitt id „naechster-schritt“): weiterlesen, unverbindlich fragen – ohne Dringlichkeit, nur Kontaktwege aus den Fakten."
      : `Handlungsaufforderung am Ende (Abschnitt id „kontakt“): nur Kontaktwege, die in den Fakten stehen. Schritt ${CONTENT_STEP_HORMOZI} (Hormozi) schärft sie.`,
    firmenname: context.organisationName || "[Firmenname]",
    cta_regel: ratgeber
      ? "Ratgeberartikel: Problem–Lösung-Zyklus, am Ende ein weicher nächster Schritt (weiterlesen, unverbindlich fragen). Kein harter Verkauf, keine Dringlichkeit."
      : "Jede Handlungsaufforderung nennt, was der Leser bekommt und was der nächste Schritt ist.",
  };
}

/** The step's own instruction: the text saved under Globale Prompts, or the default; page parts filled in. */
export function stepInstruction(context: ContentPipelineContext, key: ContentStepPromptKey): string {
  return fillContentStepPrompt(resolveContentStepPrompt(key, context.stepPrompts?.[key]), contentStepPromptVariables(context));
}

/**
 * System prompt of an editable step: the instruction first, then what the code always adds
 * after it — the locked rules, step-specific blocks (SEO: Texter prompt and Textvorlage) and
 * the Branchenregel. The user message and the tool schema stay with the spec.
 */
export function stepSystem(instruction: string, settings: ContentTextSettings, extra: readonly string[] = []): string {
  return join([instruction, BASE_RULES, ...extra, brancheRules(settings)]);
}

// --- the steps ---------------------------------------------------------------------------------

function analyse(context: ContentPipelineContext): ContentStepSpec {
  const { page } = context;
  const crawl = page.source === "crawl";
  const standalone = page.source === "standalone";
  return {
    maxTokens: 6_000,
    system: `${BASE_RULES}

Schritt ${CONTENT_STEP_ANALYSE} Analyse: Du legst fest, wonach Menschen suchen, wenn sie diese Seite brauchen, welche Fragen sie dabei haben, was die Seite leisten muss und welche Fakten dafür belegt sind. Du schreibst die Seite NICHT.

Suchintention: intent.primary ist genau einer von ${CONTENT_INTENTS.join(" | ")}; modifiers aus ${CONTENT_INTENT_MODIFIERS.join(" | ")} (mehrere möglich, ymyl = Gesundheit, Recht, Geld). journey_phase: ${CONTENT_JOURNEY_PHASES.join(" | ")}. conversion_goal: ${CONTENT_CONVERSION_GOALS.join(" | ")}. content_angle: ${CONTENT_ANGLES.join(" | ")}. Nur diese Werte.
Keywords: ${
      page.keywords
        ? `Das Hauptkeyword ${briefingLabel(page)} ist gesetzt – übernimm es wörtlich als main_keyword, nicht ersetzen, nicht umformulieren. Nebenkeywords ${briefingLabel(page)} übernehmen und um 2–5 passende Varianten ergänzen; kein Suchvolumen erfinden.`
        : crawl
          ? "Diese Seite kommt aus dem Crawl, ohne Briefing: Leite Haupt- und Nebenkeywords aus Seite, Leistung, Avatar und Ort (nur wenn der Anbieter regional arbeitet und ein Ort in den Fakten steht) ab. Der bisherige Text ist nur Orientierung für Thema und Begriffe."
          : standalone
            ? "Das Briefing nennt kein Hauptkeyword: Leite Haupt- und Nebenkeywords aus Seitenname, hochgeladenem Material, Leistung, Avatar und Ort (nur wenn der Anbieter regional arbeitet und ein Ort in den Fakten steht) ab, 2–5 Wörter. Das Material ist nur Orientierung für Thema und Begriffe."
            : "Es gibt kein Hauptkeyword aus der Excel: leite es aus Seite, Leistung und Ort (nur aus den Fakten) ab, 2–5 Wörter."
    }
main_question: die eine Frage, die der Suchende sich selbst stellt. Nie eine Frage AN den Kunden („Welche Leistungen bieten Sie?“ ist falsch), nie mit Firmenname.
fanout_questions: mindestens 8 Fragen, die eine vollständige Antwort auf main_question abdecken muss (KI-Suchen fächern so auf). ${
      page.user_questions.length > 0
        ? `Die Nutzerfragen ${standalone ? "aus dem Briefing" : "aus Spalte H"} sind echte Google-Fragen: alle übernehmen, Wortlaut beibehalten, source „Spalte H“. Weitere Fragen ergänzen mit source „Recherche“, „Avatar“ oder „Anbieterfakten“.`
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
  const general = context.texterPrompt?.trim() || DEFAULT_TEXTER_PROMPT;
  return {
    maxTokens: 12_000,
    system: stepSystem(stepInstruction(context, "seo"), context.settings, [
      `Allgemeine Regeln (jeder Seitentyp):\n${general}`,
      `Seitentyp-Vorlage (gilt bei Widerspruch vor den allgemeinen Regeln):\n${pageTypeRules(context)}`,
    ]),
    user: join([
      pageBlock(context),
      outputBlock(context, CONTENT_STEP_ANALYSE, `Analyse (Schritt ${CONTENT_STEP_ANALYSE})`),
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
    system: stepSystem(stepInstruction(context, "faktencheck"), context.settings),
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

/** Output size of the GEO rewrite; the standalone GEO tool uses the same budget. */
export const GEO_MAX_TOKENS = 12_000;

const DEFAULT_GEO_INSTRUCTION = resolveContentStepPrompt("geo", null);

/**
 * System prompt of the GEO step. The standalone GEO tool (Verwaltung → GEO) sends exactly this
 * prompt, so an uploaded text is reworked by the same rules as a page of the pipeline. The
 * instruction is the saved GEO text from Globale Prompts (or the default), already filled.
 */
export function geoSystemPrompt(settings: ContentTextSettings, instruction: string = DEFAULT_GEO_INSTRUCTION): string {
  return stepSystem(instruction, settings);
}

export const GEO_TOOL: Anthropic.Tool = {
  name: "submit_geo_text",
  description: "Der für KI-Zitate überarbeitete Seitentext in Abschnitten.",
  input_schema: TEXT_TOOL_SCHEMA,
};

/** The GEO step's answer → text; a dropped hero block comes back from the previous text. */
export function normalizeGeoOutput(json: unknown, context: ContentCurrentText): TextOutput {
  const out = normalizeTextOutput(json, context);
  return { ...out, blocks: keepHeroBlock(out.blocks, context.blocks) };
}

/**
 * The outdated Abschnitte the Aktualitätsprüfung sent back to GEO (once per run). Its own
 * block, not the editor's notes: the notes are confirmed facts, these are proposals with
 * web sources. Empty when nothing waits.
 */
export function freshnessSendBackBlock(context: Pick<ContentPipelineContext, "freshness">): string {
  const sections = context.freshness?.pending_sections ?? [];
  if (sections.length === 0) return "";
  return [
    "## Aktualitätsprüfung – bitte umsetzen",
    `Die Aktualitätsprüfung (Schritt ${CONTENT_STEP_AKTUALITAET}) hat diese Abschnitte als veraltet gemeldet. Überarbeite sie nach dem Vorschlag; öffentliche Fakten aus den genannten Quellen dürfen dafür in den Text, Angaben über den Kunden weiter nur aus den Anbieterfakten. Quellen und URLs gehören nicht in den Text. Danach prüft die Aktualitätsprüfung den Text noch einmal.`,
    ...sections.map((section, i) =>
      [
        `${i + 1}. Abschnitt „${section.section}“${section.block_id ? ` (id ${section.block_id})` : ""}`,
        section.problem ? `Problem: ${section.problem}` : "",
        section.suggestion ? `Vorschlag: ${section.suggestion}` : "",
        section.sources.length > 0
          ? `Quellen: ${section.sources.map((src) => (src.title ? `${src.title} – ${src.url}` : src.url)).join("; ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n\n");
}

function geo(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: GEO_MAX_TOKENS,
    system: geoSystemPrompt(context.settings, stepInstruction(context, "geo")),
    user: join([
      pageBlock(context),
      currentTextBlock(context),
      outputBlock(context, CONTENT_STEP_ANALYSE, `Analyse (Schritt ${CONTENT_STEP_ANALYSE}) – Fragen, die der Text abdecken muss`),
      outputBlock(context, CONTENT_STEP_FAKTENCHECK, `Faktencheck (Schritt ${CONTENT_STEP_FAKTENCHECK}) – umsetzen`),
      freshnessSendBackBlock(context),
      anbieterBlock(context),
      settingsBlock(context.settings),
      avatarBlock(context),
      notesBlock(context),
    ]),
    tool: GEO_TOOL,
    normalize: normalizeGeoOutput,
  };
}

/** Output size of the Hormozi rewrite; the standalone Hormozi tool uses the same budget. */
export const HORMOZI_MAX_TOKENS = 12_000;

function hormozi(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: HORMOZI_MAX_TOKENS,
    system: stepSystem(stepInstruction(context, "hormozi"), context.settings),
    user: join([
      pageBlock(context),
      currentTextBlock(context),
      outputBlock(context, CONTENT_STEP_ANALYSE, `Analyse (Schritt ${CONTENT_STEP_ANALYSE}) – hormozi, conversion_goal und usable_facts`),
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
    system: stepSystem(stepInstruction(context, "vermenschlichung"), context.settings),
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
    system: stepSystem(stepInstruction(context, "lektorat"), context.settings),
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

/** Open points still on the page when the Endabnahme runs (the Aktualitätsprüfung's ones survive the later rewrites). */
function openFindingsBlock(context: Pick<ContentPipelineContext, "openFindings">): string {
  const findings = context.openFindings ?? [];
  if (findings.length === 0) return "";
  return `## Offene Punkte aus früheren Schritten (z. B. Aktualitätsprüfung) – in unresolved übernehmen, solange sie zutreffen\n${JSON.stringify(findings, null, 1).slice(0, MAX_OUTPUT_CHARS)}`;
}

/**
 * Output budget of the Endabnahme. It carries the open points of earlier steps into
 * `unresolved`: with GEO switched off for the page the Faktencheck's findings are still open
 * too (a real page: 13 of them plus 8 from the Lektorat, about 3,500 tokens), and 3,000 cut
 * the answer off. Only what is written is billed.
 */
export const ENDABNAHME_MAX_TOKENS = 8_000;

function endabnahme(context: ContentPipelineContext): ContentStepSpec {
  return {
    maxTokens: ENDABNAHME_MAX_TOKENS,
    system: `${BASE_RULES}

Schritt ${CONTENT_STEP_ENDABNAHME} Endabnahme: Du bist die letzte Kontrolle vor der Freigabe durch einen Menschen. Du änderst nichts mehr.
unresolved: alles, was die Freigabe noch verhindern könnte – unbelegte Zahl, rechtliches Risiko, fehlender Kontaktweg, verbotenes Wort, Anredebruch, ein stehengebliebener Platzhalter [BITTE PRÜFEN: …] oder [QUELLE BITTE ERGÄNZEN], ein nicht gefüllter Hero („${CONTENT_HERO_PLACEHOLDER}“ oder „${CONTENT_HERO_PLACEHOLDER_LEGACY}“), eine fehlende Verlinkung auf das Hauptsilo bei einer Unterseite, ein offener Punkt der Aktualitätsprüfung. Leer, wenn der Text freigegeben werden kann. Gewollt und kein Befund: [LINK: …]-Marker (setzt das Web-Team) und „Zuletzt aktualisiert: [DATUM]“.
summary: 2–3 Sätze für die Redaktion: Was die Seite leistet, worauf beim Freigeben zu achten ist.`,
    user: join([
      pageBlock(context),
      currentTextBlock(context),
      outputBlock(context, CONTENT_STEP_LEKTORAT, `Lektorat (Schritt ${CONTENT_STEP_LEKTORAT}) – gemeldete Befunde`),
      openFindingsBlock(context),
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

// --- Watermark Entfernung: every sentence rephrased, on Grok -----------------------------------

/**
 * The Watermark step runs on Grok (xAI, see `xai.ts` and `rephrase.ts`), not on Claude, and not through
 * a tool-forced JSON answer: one chunk of sections goes in as HTML and comes back as HTML.
 * This builds the prompt for one chunk; the same settings and notes as every other step.
 * The Watermark tool under Verwaltung builds its chunks with this very function (without
 * settings, see `REPHRASE_OWN_VORGABEN`), so the two never drift apart.
 */
export function rephraseChunkPrompt(context: RephrasePromptContext, chunk: readonly ContentTextBlock[]): { system: string; user: string } {
  return {
    system: REPHRASE_SYSTEM,
    user: join([
      `## Abschnitte (bitte in derselben Form zurückgeben, nur der Text darin neu formuliert)\n${rephraseChunkHtml(chunk)}`,
      context.settings ? settingsBlock(context.settings) : REPHRASE_OWN_VORGABEN,
      notesBlock(context),
    ]),
  };
}

const SPECS: Record<number, (context: ContentPipelineContext) => ContentStepSpec> = {
  [CONTENT_STEP_ANALYSE]: analyse,
  [CONTENT_STEP_SEO]: seo,
  [CONTENT_STEP_FAKTENCHECK]: faktencheck,
  [CONTENT_STEP_GEO]: geo,
  [CONTENT_STEP_HORMOZI]: hormozi,
  [CONTENT_STEP_VERMENSCHLICHUNG]: vermenschlichung,
  [CONTENT_STEP_LEKTORAT]: lektorat,
  [CONTENT_STEP_ENDABNAHME]: endabnahme,
};

export function contentStepSpec(step: number, context: ContentPipelineContext): ContentStepSpec {
  if (step === CONTENT_STEP_WATERMARK) {
    throw new Error(`Schritt ${step} läuft in Abschnittsgruppen auf Grok (rephraseChunkPrompt), nicht als Tool-Aufruf.`);
  }
  if (step === CONTENT_STEP_AKTUALITAET) {
    throw new Error(`Schritt ${step} läuft in zwei Aufrufen mit Websuche (aktualitaet.ts), nicht als einzelner Tool-Aufruf.`);
  }
  const build = SPECS[step];
  if (!build) throw new Error(`Unbekannter Schritt ${step}.`);
  return build(context);
}
