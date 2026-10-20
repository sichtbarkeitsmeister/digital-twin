/**
 * The standalone Hormozi tool (Verwaltung → Hormozi): puts the conversion layer (hero
 * sentence, Value Equation, calls to action) on one uploaded text in one Claude call. It
 * depends on nothing of Texte (no Seitenstruktur, no confirmed settings, no Analyse, no
 * Faktencheck, no page row, no background job):
 *
 *   - instruction: the Hormozi step prompt from Globale Prompts (`content_step_prompts.hormozi`,
 *     its default when none is saved), with its `{{…}}` variables filled for the page type;
 *   - Hormozi building blocks: Texte takes them from the Analyse; here the model derives them
 *     itself from avatar, Anbieterfakten and text, and returns them next to the text;
 *   - facts and reader: the organisation's Anbieterfakten and the avatar picked in the form
 *     (required: a conversion layer for nobody in particular makes no sense);
 *   - text: the uploaded file, split into blocks by `ingest.ts`, with the hero placeholder
 *     inserted after the first block, because an uploaded text has none.
 *
 * Model tier (write), token budget and the output normalisation are those of Texte step 5.
 * `hormoziToolSpec` and the helpers are pure; `runHormoziTool` loads the context and calls
 * the model (injectable for tests).
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { loadContentAnbieterSources, loadContentAvatarRow } from "@/lib/dt/content/load-sources";
import { avatarFromAgent, type WorkshopAnbieterSection } from "@/lib/dt/content/mapping";
import { loadContentModelConfig } from "@/lib/dt/content/model-config-db";
import { CONTENT_PAGE_TYPE_LABELS } from "@/lib/dt/content/page-types";
import { ContentLlmError, callContentTool } from "@/lib/dt/content/pipeline/llm";
import {
  CONTENT_HERO_BLOCK_ID,
  CONTENT_HERO_PLACEHOLDER,
  HORMOZI_MAX_TOKENS,
  TEXT_TOOL_SCHEMA,
  anbieterBlock,
  avatarBlock,
  contentStepPromptVariables,
  currentTextBlock,
  ensureHeroPlaceholder,
  heroBlock,
  isHeroPlaceholder,
  joinPromptParts,
  keepHeroBlock,
  normalizeTextOutput,
  settleHeroSentence,
  type ContentCurrentText,
  type TextOutput,
} from "@/lib/dt/content/pipeline/prompts";
import { estimateCostEur, roundEur } from "@/lib/dt/content/pricing";
import { htmlToPlainText, normalizeBlocks, renderBlocksHtml, type ContentTextBlock } from "@/lib/dt/content/render";
import { fillContentStepPrompt, loadContentStepPrompts, resolveContentStepPrompt } from "@/lib/dt/content/step-prompts";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import { SEO_TOOL_PAGE_TYPES, type SeoToolPageType } from "@/lib/dt/text-tools/seo";

/** The `mode` of the usage event of a run. */
export const HORMOZI_TOOL_USAGE_MODE = "text-tool.hormozi";
/** The run route may take 300 s; the model gets most of it, the rest is reading the file and answering. */
export const HORMOZI_TOOL_TIMEOUT_MS = 270_000;
/** A hero retry rewrites the whole text again; with less time left it would only run into the limit. */
export const HORMOZI_TOOL_MIN_RETRY_MS = 60_000;

const blockSchema = z.object({
  id: z.string().min(1).max(60),
  heading: z.string().nullable(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  html: z.string(),
});

/** What the run route hands to `runHormoziTool` after reading the form and the file. */
export const hormoziToolRequestSchema = z.object({
  organisationId: z.string().uuid(),
  userId: z.string().uuid(),
  fileName: z.string().min(1).max(260),
  /** Label for the prompt and the export's file name; never a database key. */
  pageName: z.string().trim().max(200).nullable(),
  pageType: z.enum(SEO_TOOL_PAGE_TYPES),
  /** The avatar picked in the form; required, the conversion layer is written for this reader. */
  avatarId: z.string().uuid(),
  blocks: z.array(blockSchema).min(1).max(40),
  /** `<title>` / meta description of an HTML upload, null otherwise. */
  title: z.string().max(200).nullable(),
  metaDescription: z.string().max(400).nullable(),
});

export type HormoziToolRequest = z.infer<typeof hormoziToolRequestSchema>;

/** What Texte's Analyse delivers as `hormozi`; here the model derives it and returns it. */
export type HormoziToolBausteine = {
  traumziel: string;
  hauptschmerz: string;
  groesste_huerde: string;
  moeglicher_beweis: string;
  gewuenschter_cta: string;
};

export type HormoziToolResult = {
  blocks: ContentTextBlock[];
  title: string | null;
  meta_description: string | null;
  /** The building blocks the text was written with, as the model returned them. */
  hormozi: HormoziToolBausteine;
  /** The blocks rendered as the stored page HTML (`<section data-block-id>`), for preview and export. */
  html: string;
  /** Model of the last call. Tokens and cost add up both calls when the hero needed a retry. */
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_eur: number;
  file_name: string;
  page_name: string | null;
  page_type: SeoToolPageType;
  avatar_name: string;
  /** Number of blocks the upload had, for the result line. */
  input_blocks: number;
};

/** Everything the prompt reads; the loader fills it from the database. */
export type HormoziToolContext = {
  organisationName: string;
  fileName: string;
  pageName: string | null;
  pageType: SeoToolPageType;
  sections: WorkshopAnbieterSection[];
  avatar: { name: string; role: string; beschreibung: string };
  /** The Hormozi instruction saved under Globale Prompts; empty or missing means its default. */
  hormoziPrompt: string | null;
  /** The text as uploaded, without hero placeholder. */
  blocks: ContentTextBlock[];
  title: string | null;
  metaDescription: string | null;
};

// --- prompt ------------------------------------------------------------------------------------

/**
 * The fixed rules the code always adds after the instruction. Like Texte's locked rules, but
 * without the Vorgaben (Anrede, Tonalität, verbotene Wörter), the Branchenregel and the
 * Anmerkungen this tool has not: the uploaded text keeps its own voice.
 */
export const HORMOZI_TOOL_RULES = `Du arbeitest für eine Agentur, die Webseitentexte für kleine Unternehmen schreibt. Sprache: Deutsch.
Tatsachen (Leistungen, Zahlen, Namen, Preise, Abläufe, Orte, Beweise) kommen ausschließlich aus dem hochgeladenen Text und den Anbieterfakten. Nichts erfinden, nichts aus Branchenwissen ergänzen. Eine Angabe im Text, die den Anbieterfakten widerspricht, bleibt stehen und bekommt den Marker [BITTE PRÜFEN: …]; nichts streichen.
Es gibt keine Vorgaben zu Anrede und Tonalität: Anrede und Ton bleiben wie im hochgeladenen Text, passend zum Avatar.
Fehlen Kontaktwege, Preise, Garantien oder Beweise, die eine Handlungsaufforderung oder die Value Equation bräuchte: Marker [BITTE PRÜFEN: was genau fehlt] statt erfinden. Verknappung, Garantien und Fristen nur, wenn sie in den Anbieterfakten stehen.`;

/** The Hormozi instruction from Globale Prompts with its variables filled for the chosen page type. */
export function hormoziToolInstruction(context: Pick<HormoziToolContext, "organisationName" | "pageType" | "hormoziPrompt">): string {
  return fillContentStepPrompt(
    resolveContentStepPrompt("hormozi", context.hormoziPrompt),
    contentStepPromptVariables({ organisationName: context.organisationName, page: { source: "standalone", page_type: context.pageType } }),
  );
}

export function hormoziToolSystemPrompt(context: Pick<HormoziToolContext, "organisationName" | "pageType" | "hormoziPrompt">): string {
  return joinPromptParts([hormoziToolInstruction(context), HORMOZI_TOOL_RULES]);
}

/**
 * The upload with the hero placeholder right after the first block, where Texte's SEO step
 * leaves it. A first block with a heading is the H1 (`ensureHeroPlaceholder`); a first block
 * without one keeps its level, so no paragraph becomes an H1. A hero block the upload already
 * has (a Texte export) is replaced: this tool always writes the hero.
 */
export function hormoziToolInputBlocks(blocks: readonly ContentTextBlock[]): ContentTextBlock[] {
  const rest = blocks.filter((b) => b.id !== CONTENT_HERO_BLOCK_ID);
  const [first, ...others] = rest;
  if (!first) return [];
  if (first.heading?.trim()) return ensureHeroPlaceholder(rest);
  return [first, { id: CONTENT_HERO_BLOCK_ID, heading: CONTENT_HERO_PLACEHOLDER, level: 2, html: "" }, ...others];
}

function pageBlock(context: HormoziToolContext): string {
  return [
    "## Seite",
    `Organisation: ${context.organisationName || "unbekannt"}`,
    context.pageName ? `Seite: ${context.pageName}` : "",
    `Seitentyp: ${CONTENT_PAGE_TYPE_LABELS[context.pageType]}`,
    `Quelle: hochgeladene Datei „${context.fileName}“ (eigenständiges Hormozi-Werkzeug; keine Seitenstruktur, keine Linkziele bekannt, vorhandene [LINK: …]-Marker bleiben)`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Stands where Texte puts the Analyse (step 1): this tool has none, the model derives the building blocks. */
export const HORMOZI_TOOL_NO_ANALYSE = `## Vorschritte
Es gibt keine Analyse (Schritt 1), keinen Faktencheck und keine Anmerkungen der Redaktion. Wo die Anweisung „aus der Analyse“ sagt, leitest du die Hormozi-Bausteine selbst ab, nur aus Avatar, Anbieterfakten und Text: traumziel, hauptschmerz, groesste_huerde, moeglicher_beweis (nur belegte Beweise, sonst „kein belegter Beweis“), gewuenschter_cta (passend zu Seitentyp und den Kontaktwegen aus den Fakten). Gib sie im Feld hormozi zurück und schreibe den Text damit.`;

/** Appended to the message for the one retry when the first answer left the hero empty. */
export const HORMOZI_TOOL_HERO_RETRY_NOTE = "Der Hero-Satz fehlt: genau ein Satz als <p> im Abschnitt hero.";

function currentText(context: HormoziToolContext): ContentCurrentText {
  return { blocks: hormoziToolInputBlocks(context.blocks), title: context.title, metaDescription: context.metaDescription };
}

export function hormoziToolUserPrompt(context: HormoziToolContext): string {
  return joinPromptParts([pageBlock(context), HORMOZI_TOOL_NO_ANALYSE, currentTextBlock(currentText(context)), anbieterBlock(context), avatarBlock(context)]);
}

const BAUSTEINE_KEYS = ["traumziel", "hauptschmerz", "groesste_huerde", "moeglicher_beweis", "gewuenschter_cta"] as const;

export const HORMOZI_TOOL: Anthropic.Tool = {
  name: "submit_hormozi_tool_text",
  description: "Der Seitentext mit Hero-Satz, Value Equation und geschärften Handlungsaufforderungen, dazu die abgeleiteten Hormozi-Bausteine.",
  input_schema: {
    type: "object",
    properties: {
      ...(TEXT_TOOL_SCHEMA.properties as Record<string, unknown>),
      hormozi: {
        type: "object",
        description: "Die Hormozi-Bausteine, mit denen der Text geschrieben ist; nur aus Avatar, Anbieterfakten und Text.",
        properties: {
          traumziel: { type: "string", description: "Was der Avatar wirklich will." },
          hauptschmerz: { type: "string" },
          groesste_huerde: { type: "string", description: "Was ihn vom Auftrag abhält." },
          moeglicher_beweis: { type: "string", description: "Nur belegte Beweise aus Text oder Anbieterfakten, sonst „kein belegter Beweis“." },
          gewuenschter_cta: { type: "string", description: "Passend zu Seitentyp und den Kontaktwegen aus den Fakten." },
        },
        required: [...BAUSTEINE_KEYS],
      },
    },
    required: [...(TEXT_TOOL_SCHEMA.required ?? []), "hormozi"],
  },
};

export function hormoziToolSpec(context: HormoziToolContext) {
  return {
    system: hormoziToolSystemPrompt(context),
    user: hormoziToolUserPrompt(context),
    tool: HORMOZI_TOOL,
    maxTokens: HORMOZI_MAX_TOKENS,
  };
}

function normalizeBausteine(raw: unknown): HormoziToolBausteine {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const field = (key: (typeof BAUSTEINE_KEYS)[number]) => {
    const value = r[key];
    return typeof value === "string" ? value.trim().slice(0, 400) : "";
  };
  return {
    traumziel: field("traumziel"),
    hauptschmerz: field("hauptschmerz"),
    groesste_huerde: field("groesste_huerde"),
    moeglicher_beweis: field("moeglicher_beweis"),
    gewuenschter_cta: field("gewuenschter_cta"),
  };
}

/** The model's answer → text as Texte step 5 normalises it (hero kept, hero sentence as <p>) plus the building blocks. */
export function normalizeHormoziToolOutput(json: unknown, current: ContentCurrentText): TextOutput & { hormozi: HormoziToolBausteine } {
  const out = normalizeTextOutput(json, current);
  return {
    ...out,
    blocks: settleHeroSentence(keepHeroBlock(out.blocks, current.blocks)),
    hormozi: normalizeBausteine((json as { hormozi?: unknown } | null)?.hormozi),
  };
}

/** True when the hero block carries a sentence, not the placeholder and not an empty body. */
export function hasHeroSentence(blocks: readonly ContentTextBlock[]): boolean {
  const hero = heroBlock(blocks);
  return Boolean(hero && !isHeroPlaceholder(hero) && htmlToPlainText(hero.html).trim());
}

// --- run -----------------------------------------------------------------------------------------

/**
 * Loads what the prompt reads: the chosen avatar, organisation name, Anbieterfakten and the
 * Hormozi instruction from Globale Prompts. The avatar comes first: one of another
 * organisation (or a deleted one) is refused before anything else is read. Without
 * Anbieterfakten the tool still runs; missing proof and contact details get placeholders.
 */
export async function loadHormoziToolContext(service: SupabaseClient, request: HormoziToolRequest): Promise<HormoziToolContext> {
  const avatarRow = await loadContentAvatarRow(service, request.organisationId, request.avatarId);
  if (!avatarRow) {
    throw new ContentLlmError("Der gewählte Avatar gehört nicht zu dieser Organisation oder existiert nicht mehr. Bitte neu wählen.", false);
  }
  const [{ data: organisation }, anbieter, stepPrompts] = await Promise.all([
    service.from("organisations").select("name").eq("id", request.organisationId).maybeSingle(),
    loadContentAnbieterSources(service, request.organisationId),
    loadContentStepPrompts(service),
  ]);
  const avatar = avatarFromAgent(avatarRow);
  return {
    organisationName: (organisation?.name as string | undefined)?.trim() || "",
    fileName: request.fileName,
    pageName: request.pageName?.trim() || null,
    pageType: request.pageType,
    sections: anbieter.sections,
    avatar: { name: avatar.name, role: avatar.role, beschreibung: avatar.beschreibung },
    hormoziPrompt: stepPrompts.hormozi,
    blocks: request.blocks,
    title: request.title,
    metaDescription: request.metaDescription,
  };
}

export type HormoziToolModelCall = (input: {
  models: string[];
  system: string;
  user: string;
  tool: Anthropic.Tool;
  maxTokens: number;
  timeoutMs?: number;
}) => Promise<{ json: unknown; usage: { inputTokens: number; outputTokens: number }; model: string }>;

export type HormoziToolUsage = { model: string; inputTokens: number; outputTokens: number };

/**
 * One call on a loaded context, a second one only when the hero sentence is missing; pure
 * apart from `call`. `onUsage` hears about every call, also one whose answer is then refused.
 * An answer without blocks is an error, not the uploaded text handed back as if reworked.
 */
export async function runHormoziOnContext(
  context: HormoziToolContext,
  options: { models: string[]; call?: HormoziToolModelCall; timeoutMs?: number; onUsage?: (usage: HormoziToolUsage) => Promise<void> | void },
): Promise<{ result: HormoziToolResult; usage: HormoziToolUsage[] }> {
  const spec = hormoziToolSpec(context);
  const current = currentText(context);
  const call = options.call ?? callContentTool;
  const budget = options.timeoutMs ?? HORMOZI_TOOL_TIMEOUT_MS;
  const started = Date.now();
  const usage: HormoziToolUsage[] = [];

  const ask = async (user: string, timeoutMs: number) => {
    const answer = await call({ models: options.models, system: spec.system, user, tool: spec.tool, maxTokens: spec.maxTokens, timeoutMs });
    const used = { model: answer.model, inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens };
    usage.push(used);
    await options.onUsage?.(used);
    if (normalizeBlocks((answer.json as { blocks?: unknown } | null)?.blocks).length === 0) {
      throw new ContentLlmError("Das Modell hat keinen überarbeiteten Text geliefert. Bitte erneut versuchen.", true);
    }
    return normalizeHormoziToolOutput(answer.json, current);
  };
  const noHero = () => new ContentLlmError("Das Modell hat keinen Hero-Satz geliefert. Bitte erneut versuchen.", true);

  let output = await ask(spec.user, budget);
  if (!hasHeroSentence(output.blocks)) {
    const remaining = budget - (Date.now() - started);
    if (remaining < HORMOZI_TOOL_MIN_RETRY_MS) throw noHero();
    output = await ask(`${spec.user}\n\n${HORMOZI_TOOL_HERO_RETRY_NOTE}`, remaining);
    if (!hasHeroSentence(output.blocks)) throw noHero();
  }

  const last = usage[usage.length - 1]!;
  return {
    usage,
    result: {
      blocks: output.blocks,
      title: output.title,
      meta_description: output.meta_description,
      hormozi: output.hormozi,
      html: renderBlocksHtml(output.blocks),
      model: last.model,
      input_tokens: usage.reduce((sum, u) => sum + u.inputTokens, 0),
      output_tokens: usage.reduce((sum, u) => sum + u.outputTokens, 0),
      cost_eur: roundEur(usage.reduce((sum, u) => sum + estimateCostEur(u.model, u), 0)),
      file_name: context.fileName,
      page_name: context.pageName,
      page_type: context.pageType,
      avatar_name: context.avatar.name,
      input_blocks: context.blocks.length,
    },
  };
}

/** One run: context, the call(s) on the write tier of the Texte models, one usage event per call, the result. */
export async function runHormoziTool(
  service: SupabaseClient,
  request: HormoziToolRequest,
  options: { call?: HormoziToolModelCall; timeoutMs?: number } = {},
): Promise<HormoziToolResult> {
  const [context, models] = await Promise.all([loadHormoziToolContext(service, request), loadContentModelConfig(service)]);
  const onUsage = (usage: HormoziToolUsage) =>
    recordLlmUsageEvent(service, {
      organisationId: request.organisationId,
      userId: request.userId,
      agentId: request.avatarId,
      mode: HORMOZI_TOOL_USAGE_MODE,
      via: "direct",
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    }).catch((error: unknown) => console.warn("[text-tool.hormozi] usage not recorded:", error instanceof Error ? error.message : error));
  const { result } = await runHormoziOnContext(context, { models: models.write, ...options, onUsage });
  return result;
}
