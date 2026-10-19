/**
 * The standalone SEO tool (Verwaltung → SEO): writes one page text from a page name, a page
 * type and an optional upload, in one Claude call. It depends on nothing of Texte (no
 * Seitenstruktur, no confirmed settings, no Analyse, no page row, no background job):
 *
 *   - instruction: the SEO step prompt from Globale Prompts (`content_step_prompts.seo`,
 *     its default when none is saved), with its `{{…}}` variables filled for this page;
 *   - Textvorlage: the tool's own set (`dt_content_type_prompts`, id `seo_tool`), which
 *     changes only when someone saves it here, never when Texte saves its set;
 *   - facts and reader: the organisation's Anbieterfakten and the avatar picked in the form.
 *
 * Tool schema (`submit_seo_text`), model tier (write) and the hero placeholder are those of
 * Texte step 2. `seoToolSpec` and the helpers are pure; `runSeoTool` loads the context and
 * calls the model (injectable for tests).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { loadContentAnbieterSources, loadContentAvatarRow } from "@/lib/dt/content/load-sources";
import { avatarFromAgent, type WorkshopAnbieterSection } from "@/lib/dt/content/mapping";
import { loadContentModelConfig } from "@/lib/dt/content/model-config-db";
import { CONTENT_PAGE_TYPE_LABELS, type ContentPageType } from "@/lib/dt/content/page-types";
import { ContentLlmError, callContentTool } from "@/lib/dt/content/pipeline/llm";
import {
  MAX_STANDALONE_MATERIAL_CHARS,
  TEXT_TOOL_SCHEMA,
  anbieterBlock,
  avatarBlock,
  contentStepPromptVariables,
  ensureHeroPlaceholder,
  joinPromptParts,
  normalizeTextOutput,
  type TextOutput,
} from "@/lib/dt/content/pipeline/prompts";
import { estimateCostEur, roundEur } from "@/lib/dt/content/pricing";
import { htmlToPlainText, renderBlocksHtml, type ContentTextBlock } from "@/lib/dt/content/render";
import { fillContentStepPrompt, loadContentStepPrompts, resolveContentStepPrompt } from "@/lib/dt/content/step-prompts";
import { loadContentTypePromptsForRun } from "@/lib/dt/content/type-prompts-db";
import { renderContentTypePrompt, type ContentTypePrompts } from "@/lib/dt/content/type-prompts";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";

/** The `mode` of the usage event of a run. */
export const SEO_TOOL_USAGE_MODE = "text-tool.seo";
export const SEO_TOOL_MAX_TOKENS = 12_000;
/** The run route may take 300 s; the model gets most of it, the rest is loading and answering. */
export const SEO_TOOL_TIMEOUT_MS = 270_000;

/** The page types the dropdown offers („Nicht bearbeiten“ has no Textvorlage and no text). */
export const SEO_TOOL_PAGE_TYPES = ["hauptsilo", "hauptseite", "unterseite", "ratgeber", "standort", "startseite", "ueber_uns"] as const satisfies readonly ContentPageType[];
export type SeoToolPageType = (typeof SEO_TOOL_PAGE_TYPES)[number];

/** The uploaded material as plain text; longer uploads are clipped here, not refused. */
export const SEO_TOOL_MAX_MATERIAL_CHARS = MAX_STANDALONE_MATERIAL_CHARS;

export function isSeoToolPageType(value: unknown): value is SeoToolPageType {
  return typeof value === "string" && (SEO_TOOL_PAGE_TYPES as readonly string[]).includes(value);
}

/** „Hauptsilo-Seite“ … for the dropdown and the result line. */
export const SEO_TOOL_PAGE_TYPE_OPTIONS: ReadonlyArray<{ value: SeoToolPageType; label: string }> = SEO_TOOL_PAGE_TYPES.map((value) => ({
  value,
  label: CONTENT_PAGE_TYPE_LABELS[value],
}));

/** What the run route hands to `runSeoTool` after reading the form. */
export const seoToolRequestSchema = z.object({
  organisationId: z.string().uuid(),
  userId: z.string().uuid(),
  /** Label for the prompt and the export's file name; never a database key. */
  pageName: z.string().trim().min(1).max(200),
  pageType: z.enum(SEO_TOOL_PAGE_TYPES),
  /** The avatar picked in the form; null writes without one. */
  avatarId: z.string().uuid().nullable(),
  /** The upload's name, null without one. */
  fileName: z.string().min(1).max(260).nullable(),
  /** The upload as plain text (headings as Markdown lines), null without one. */
  material: z.string().max(SEO_TOOL_MAX_MATERIAL_CHARS + 100).nullable(),
});

export type SeoToolRequest = z.infer<typeof seoToolRequestSchema>;

export type SeoToolResult = {
  blocks: ContentTextBlock[];
  title: string | null;
  meta_description: string | null;
  /** The blocks rendered as the stored page HTML (`<section data-block-id>`), for preview and export. */
  html: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_eur: number;
  page_name: string;
  page_type: SeoToolPageType;
  avatar_name: string | null;
  file_name: string | null;
};

/** Everything the prompt reads; the loader fills it from the database. */
export type SeoToolContext = {
  organisationName: string;
  pageName: string;
  pageType: SeoToolPageType;
  material: string | null;
  sections: WorkshopAnbieterSection[];
  avatar: { name: string; role: string; beschreibung: string } | null;
  /** The SEO instruction saved under Globale Prompts; empty or missing means its default. */
  seoPrompt: string | null;
  /** The tool's own Textvorlagen. */
  typePrompts: ContentTypePrompts;
};

// --- prompt ------------------------------------------------------------------------------------

/**
 * The fixed rules the code always adds after the instruction. Like Texte's locked rules, but
 * without the Vorgaben (Anrede, Tonalität, verbotene Wörter) and Anmerkungen this tool has not.
 */
export const SEO_TOOL_RULES = `Du arbeitest für eine Agentur, die Webseitentexte für kleine Unternehmen schreibt. Sprache: Deutsch.
Tatsachen (Leistungen, Zahlen, Namen, Preise, Abläufe, Orte) kommen ausschließlich aus den Anbieterfakten. Nichts erfinden, nichts aus Branchenwissen ergänzen. Fehlt eine Angabe, bleibt sie weg oder steht als Platzhalter [BITTE PRÜFEN: was genau fehlt] im Text.
Es gibt keine Vorgaben zu Anrede und Tonalität: Anrede wie im hochgeladenen Material, sonst „Sie“; Ton sachlich und nahbar, passend zum Avatar.`;

/** The SEO instruction from Globale Prompts with its variables filled for this page. */
export function seoToolInstruction(context: Pick<SeoToolContext, "organisationName" | "pageType" | "seoPrompt">): string {
  return fillContentStepPrompt(
    resolveContentStepPrompt("seo", context.seoPrompt),
    contentStepPromptVariables({ organisationName: context.organisationName, page: { source: "standalone", page_type: context.pageType } }),
  );
}

/** The Textvorlage of the chosen type from the tool's own set (no Hauptsilo in this tool). */
export function seoToolTypeRules(context: Pick<SeoToolContext, "typePrompts" | "pageType">): string {
  return renderContentTypePrompt(context.typePrompts, context.pageType, null);
}

export function seoToolSystemPrompt(context: SeoToolContext): string {
  return joinPromptParts([
    seoToolInstruction(context),
    SEO_TOOL_RULES,
    `Seitentyp-Vorlage (gilt bei Widerspruch vor der Anweisung oben):\n${seoToolTypeRules(context)}`,
  ]);
}

function pageBlock(context: SeoToolContext): string {
  return [
    "## Seite",
    `Organisation: ${context.organisationName || "unbekannt"}`,
    `Seite: ${context.pageName}`,
    `Seitentyp: ${CONTENT_PAGE_TYPE_LABELS[context.pageType]}`,
    "Quelle: eigenständiges SEO-Werkzeug (Seitenname, Seitentyp und ggf. hochgeladenes Material; keine Seitenstruktur, keine anderen Seiten bekannt)",
    "Hauptkeyword: nicht vorgegeben",
    "Erlaubte interne Linkziele: keine bekannt – keine internen Links setzen",
  ].join("\n");
}

/** Stands where Texte puts the Analyse (step 1): this tool has none, the model derives it. */
const NO_ANALYSE_BLOCK = `## Analyse
Es gibt keine Analyse (Schritt 1). Leite Hauptkeyword (2–5 Wörter), Nebenkeywords, main_question und fanout_questions selbst aus Seitenname, Seitentyp, hochgeladenem Material, Anbieterfakten und Avatar ab, bevor du schreibst. deferred_questions gibt es keine.`;

function materialBlock(material: string | null): string {
  const text = material?.trim();
  if (!text) return "";
  return `## Hochgeladenes Material (Briefing oder bisheriger Text, nur zur Orientierung)
Thema, Umfang, Begriffe, Aufbau. Fakten daraus gelten nur, wenn sie auch in den Anbieterfakten stehen – sonst sind sie unbelegt und bekommen [BITTE PRÜFEN: …].
${text.slice(0, SEO_TOOL_MAX_MATERIAL_CHARS)}`;
}

export function seoToolUserPrompt(context: SeoToolContext): string {
  return joinPromptParts([pageBlock(context), NO_ANALYSE_BLOCK, materialBlock(context.material), anbieterBlock(context), avatarBlock(context)]);
}

const EMPTY_TEXT = { blocks: [], title: null, metaDescription: null };

/** The model's answer → blocks with the H1 first and the hero placeholder right under it. */
export function normalizeSeoToolOutput(json: unknown): TextOutput {
  const out = normalizeTextOutput(json, EMPTY_TEXT);
  return { ...out, blocks: ensureHeroPlaceholder(out.blocks) };
}

export function seoToolSpec(context: SeoToolContext) {
  return {
    system: seoToolSystemPrompt(context),
    user: seoToolUserPrompt(context),
    tool: {
      name: "submit_seo_text",
      description: "Der vollständige Seitentext in Abschnitten, mit Title und Meta-Description.",
      input_schema: TEXT_TOOL_SCHEMA,
    },
    maxTokens: SEO_TOOL_MAX_TOKENS,
  };
}

/**
 * The upload as the prompt reads it: headings as Markdown lines, the body as plain text,
 * clipped to the material limit (the ingest refuses longer texts up front anyway).
 */
export function materialTextFromBlocks(blocks: readonly ContentTextBlock[]): string | null {
  const text = blocks
    .map((b) => {
      const heading = b.heading ? `${"#".repeat(b.level)} ${b.heading}\n` : "";
      return `${heading}${htmlToPlainText(b.html)}`.trim();
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!text) return null;
  return text.length > SEO_TOOL_MAX_MATERIAL_CHARS ? `${text.slice(0, SEO_TOOL_MAX_MATERIAL_CHARS)}\n[… gekürzt]` : text;
}

// --- run -----------------------------------------------------------------------------------------

/**
 * Loads what the prompt reads: organisation name, Anbieterfakten, the chosen avatar, the SEO
 * instruction from Globale Prompts and the tool's own Textvorlagen. Nothing here is required;
 * without Anbieterfakten the text gets placeholders, without avatar it is written for nobody
 * in particular. An avatar id of another organisation is refused.
 */
export async function loadSeoToolContext(service: SupabaseClient, request: SeoToolRequest): Promise<SeoToolContext> {
  const [{ data: organisation }, anbieter, typePrompts, stepPrompts, avatarRow] = await Promise.all([
    service.from("organisations").select("name").eq("id", request.organisationId).maybeSingle(),
    loadContentAnbieterSources(service, request.organisationId),
    loadContentTypePromptsForRun(service, "seo_tool"),
    loadContentStepPrompts(service),
    request.avatarId ? loadContentAvatarRow(service, request.organisationId, request.avatarId) : Promise.resolve(null),
  ]);
  if (request.avatarId && !avatarRow) {
    throw new ContentLlmError("Der gewählte Avatar gehört nicht zu dieser Organisation oder existiert nicht mehr. Bitte neu wählen.", false);
  }
  const avatar = avatarRow ? avatarFromAgent(avatarRow) : null;
  return {
    organisationName: (organisation?.name as string | undefined)?.trim() || "",
    pageName: request.pageName.trim(),
    pageType: request.pageType,
    material: request.material,
    sections: anbieter.sections,
    avatar: avatar ? { name: avatar.name, role: avatar.role, beschreibung: avatar.beschreibung } : null,
    seoPrompt: stepPrompts.seo,
    typePrompts,
  };
}

export type SeoToolModelCall = (input: {
  models: string[];
  system: string;
  user: string;
  tool: ReturnType<typeof seoToolSpec>["tool"];
  maxTokens: number;
  timeoutMs?: number;
}) => Promise<{ json: unknown; usage: { inputTokens: number; outputTokens: number }; model: string }>;

/** One call on a loaded context; pure apart from `call`. Throws `ContentLlmError` on an empty answer. */
export async function runSeoOnContext(
  context: SeoToolContext,
  request: Pick<SeoToolRequest, "fileName">,
  options: { models: string[]; call?: SeoToolModelCall; timeoutMs?: number },
): Promise<{ result: SeoToolResult; usage: { model: string; inputTokens: number; outputTokens: number } }> {
  const spec = seoToolSpec(context);
  const call = options.call ?? callContentTool;
  const answer = await call({
    models: options.models,
    system: spec.system,
    user: spec.user,
    tool: spec.tool,
    maxTokens: spec.maxTokens,
    timeoutMs: options.timeoutMs ?? SEO_TOOL_TIMEOUT_MS,
  });
  const output = normalizeSeoToolOutput(answer.json);
  if (output.blocks.length === 0) {
    throw new ContentLlmError("Das Modell hat keinen Seitentext geliefert. Bitte erneut versuchen.", true);
  }
  return {
    usage: { model: answer.model, inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens },
    result: {
      blocks: output.blocks,
      title: output.title,
      meta_description: output.meta_description,
      html: renderBlocksHtml(output.blocks),
      model: answer.model,
      input_tokens: answer.usage.inputTokens,
      output_tokens: answer.usage.outputTokens,
      cost_eur: roundEur(estimateCostEur(answer.model, answer.usage)),
      page_name: context.pageName,
      page_type: context.pageType,
      avatar_name: context.avatar?.name ?? null,
      file_name: request.fileName,
    },
  };
}

/** One run: context, one call on the write tier of the Texte models, one usage event, the result. */
export async function runSeoTool(
  service: SupabaseClient,
  request: SeoToolRequest,
  options: { call?: SeoToolModelCall; timeoutMs?: number } = {},
): Promise<SeoToolResult> {
  const [context, models] = await Promise.all([loadSeoToolContext(service, request), loadContentModelConfig(service)]);
  const { result, usage } = await runSeoOnContext(context, request, { models: models.write, ...options });
  await recordLlmUsageEvent(service, {
    organisationId: request.organisationId,
    userId: request.userId,
    agentId: request.avatarId,
    mode: SEO_TOOL_USAGE_MODE,
    via: "direct",
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  }).catch((error: unknown) => console.warn("[text-tool.seo] usage not recorded:", error instanceof Error ? error.message : error));
  return result;
}
