/**
 * The standalone GEO tool (Verwaltung → GEO): reworks one uploaded text for AI search systems
 * in one Claude call. It depends on nothing of Texte (no Seitenstruktur, no confirmed
 * settings, no Analyse, no Faktencheck, no page row, no background job):
 *
 *   - instruction: the GEO step prompt from Globale Prompts (`content_step_prompts.geo`, its
 *     default when none is saved), with its `{{…}}` variables filled;
 *   - facts and reader: the organisation's Anbieterfakten and the avatar picked in the form;
 *   - text: the uploaded file, split into blocks by `ingest.ts`.
 *
 * Tool schema (`submit_geo_text`), model tier (write) and the output normalisation are those
 * of Texte step 4. `geoToolSpec` and the helpers are pure; `runGeoTool` loads the context and
 * calls the model (injectable for tests).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { loadContentAnbieterSources, loadContentAvatarRow } from "@/lib/dt/content/load-sources";
import { avatarFromAgent, type WorkshopAnbieterSection } from "@/lib/dt/content/mapping";
import { loadContentModelConfig } from "@/lib/dt/content/model-config-db";
import { ContentLlmError, callContentTool } from "@/lib/dt/content/pipeline/llm";
import {
  GEO_MAX_TOKENS,
  GEO_TOOL,
  anbieterBlock,
  avatarBlock,
  contentStepPromptVariables,
  currentTextBlock,
  joinPromptParts,
  normalizeGeoOutput,
  type TextOutput,
} from "@/lib/dt/content/pipeline/prompts";
import { estimateCostEur, roundEur } from "@/lib/dt/content/pricing";
import { normalizeBlocks, renderBlocksHtml, type ContentTextBlock } from "@/lib/dt/content/render";
import { fillContentStepPrompt, loadContentStepPrompts, resolveContentStepPrompt } from "@/lib/dt/content/step-prompts";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";

/** The `mode` of the usage event of a run. */
export const GEO_TOOL_USAGE_MODE = "text-tool.geo";
/** The run route may take 300 s; the model gets most of it, the rest is reading the file and answering. */
export const GEO_TOOL_TIMEOUT_MS = 270_000;

const blockSchema = z.object({
  id: z.string().min(1).max(60),
  heading: z.string().nullable(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  html: z.string(),
});

/** What the run route hands to `runGeoTool` after reading the form and the file. */
export const geoToolRequestSchema = z.object({
  organisationId: z.string().uuid(),
  userId: z.string().uuid(),
  fileName: z.string().min(1).max(260),
  /** Label for the prompt and the export's file name; never a database key. */
  pageName: z.string().trim().max(200).nullable(),
  /** The avatar picked in the form; null reworks the text without one. */
  avatarId: z.string().uuid().nullable(),
  blocks: z.array(blockSchema).min(1).max(40),
  /** `<title>` / meta description of an HTML upload, null otherwise. */
  title: z.string().max(200).nullable(),
  metaDescription: z.string().max(400).nullable(),
});

export type GeoToolRequest = z.infer<typeof geoToolRequestSchema>;

export type GeoToolResult = {
  blocks: ContentTextBlock[];
  title: string | null;
  meta_description: string | null;
  /** The blocks rendered as the stored page HTML (`<section data-block-id>`), for preview and export. */
  html: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_eur: number;
  file_name: string;
  page_name: string | null;
  avatar_name: string | null;
  /** Number of blocks the upload had, for the result line. */
  input_blocks: number;
};

/** Everything the prompt reads; the loader fills it from the database. */
export type GeoToolContext = {
  organisationName: string;
  fileName: string;
  pageName: string | null;
  sections: WorkshopAnbieterSection[];
  avatar: { name: string; role: string; beschreibung: string } | null;
  /** The GEO instruction saved under Globale Prompts; empty or missing means its default. */
  geoPrompt: string | null;
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
export const GEO_TOOL_RULES = `Du arbeitest für eine Agentur, die Webseitentexte für kleine Unternehmen schreibt. Sprache: Deutsch.
Tatsachen (Leistungen, Zahlen, Namen, Preise, Abläufe, Orte) kommen ausschließlich aus dem hochgeladenen Text und den Anbieterfakten. Nichts erfinden, nichts aus Branchenwissen ergänzen; neue Angaben nur, wenn sie in den Anbieterfakten stehen. Eine Angabe im Text, die den Anbieterfakten widerspricht, bleibt stehen und bekommt den Marker [BITTE PRÜFEN: …]; nichts streichen.
Es gibt keine Vorgaben zu Anrede und Tonalität: Anrede und Ton bleiben wie im hochgeladenen Text, passend zum Avatar.`;

/** The GEO instruction from Globale Prompts with its variables filled (no page: „aus dem Briefing“, not a Ratgeber). */
export function geoToolInstruction(context: Pick<GeoToolContext, "organisationName" | "geoPrompt">): string {
  return fillContentStepPrompt(
    resolveContentStepPrompt("geo", context.geoPrompt),
    contentStepPromptVariables({ organisationName: context.organisationName, page: null }),
  );
}

export function geoToolSystemPrompt(context: Pick<GeoToolContext, "organisationName" | "geoPrompt">): string {
  return joinPromptParts([geoToolInstruction(context), GEO_TOOL_RULES]);
}

function pageBlock(context: GeoToolContext): string {
  return [
    "## Seite",
    `Organisation: ${context.organisationName || "unbekannt"}`,
    context.pageName ? `Seite: ${context.pageName}` : "",
    `Quelle: hochgeladene Datei „${context.fileName}“ (eigenständiges GEO-Werkzeug; keine Seitenstruktur, keine anderen Seiten bekannt)`,
    "Erlaubte interne Linkziele: keine bekannt – keine neuen internen Links setzen, vorhandene [LINK: …]-Marker bleiben",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Stands where Texte puts the Analyse and the Faktencheck (steps 1 and 3): this tool has neither. */
export const GEO_TOOL_NO_PRIOR_STEPS = `## Vorschritte
Es gibt keine Analyse (Schritt 1) und keinen Faktencheck (Schritt 3): keine Befunde umzusetzen, keine fanout_questions oder deferred_questions, keine Anmerkungen der Redaktion. Keine neuen Fragen hinzuerfinden; beantworte nur, was der Text und die Anbieterfakten hergeben.`;

export function geoToolUserPrompt(context: GeoToolContext): string {
  return joinPromptParts([pageBlock(context), GEO_TOOL_NO_PRIOR_STEPS, currentTextBlock(context), anbieterBlock(context), avatarBlock(context)]);
}

export function geoToolSpec(context: GeoToolContext) {
  return {
    system: geoToolSystemPrompt(context),
    user: geoToolUserPrompt(context),
    tool: GEO_TOOL,
    maxTokens: GEO_MAX_TOKENS,
  };
}

// --- run -----------------------------------------------------------------------------------------

/**
 * Loads what the prompt reads: organisation name, Anbieterfakten, the chosen avatar and the
 * GEO instruction from Globale Prompts. Nothing here is required; without Anbieterfakten the
 * text is only restructured, without avatar it is reworked for nobody in particular. An
 * avatar id of another organisation is refused.
 */
export async function loadGeoToolContext(service: SupabaseClient, request: GeoToolRequest): Promise<GeoToolContext> {
  const [{ data: organisation }, anbieter, stepPrompts, avatarRow] = await Promise.all([
    service.from("organisations").select("name").eq("id", request.organisationId).maybeSingle(),
    loadContentAnbieterSources(service, request.organisationId),
    loadContentStepPrompts(service),
    request.avatarId ? loadContentAvatarRow(service, request.organisationId, request.avatarId) : Promise.resolve(null),
  ]);
  if (request.avatarId && !avatarRow) {
    throw new ContentLlmError("Der gewählte Avatar gehört nicht zu dieser Organisation oder existiert nicht mehr. Bitte neu wählen.", false);
  }
  const avatar = avatarRow ? avatarFromAgent(avatarRow) : null;
  return {
    organisationName: (organisation?.name as string | undefined)?.trim() || "",
    fileName: request.fileName,
    pageName: request.pageName?.trim() || null,
    sections: anbieter.sections,
    avatar: avatar ? { name: avatar.name, role: avatar.role, beschreibung: avatar.beschreibung } : null,
    geoPrompt: stepPrompts.geo,
    blocks: request.blocks,
    title: request.title,
    metaDescription: request.metaDescription,
  };
}

export type GeoToolModelCall = (input: {
  models: string[];
  system: string;
  user: string;
  tool: ReturnType<typeof geoToolSpec>["tool"];
  maxTokens: number;
  timeoutMs?: number;
}) => Promise<{ json: unknown; usage: { inputTokens: number; outputTokens: number }; model: string }>;

/**
 * One call on a loaded context; pure apart from `call`. An answer without blocks is an error,
 * not the uploaded text handed back unchanged as if it had been reworked.
 */
export async function runGeoOnContext(
  context: GeoToolContext,
  options: { models: string[]; call?: GeoToolModelCall; timeoutMs?: number },
): Promise<{ result: GeoToolResult; usage: { model: string; inputTokens: number; outputTokens: number } }> {
  const spec = geoToolSpec(context);
  const call = options.call ?? callContentTool;
  const answer = await call({
    models: options.models,
    system: spec.system,
    user: spec.user,
    tool: spec.tool,
    maxTokens: spec.maxTokens,
    timeoutMs: options.timeoutMs ?? GEO_TOOL_TIMEOUT_MS,
  });
  const raw = (answer.json as { blocks?: unknown } | null)?.blocks;
  if (normalizeBlocks(raw).length === 0) {
    throw new ContentLlmError("Das Modell hat keinen überarbeiteten Text geliefert. Bitte erneut versuchen.", true);
  }
  const output: TextOutput = normalizeGeoOutput(answer.json, context);
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
      file_name: context.fileName,
      page_name: context.pageName,
      avatar_name: context.avatar?.name ?? null,
      input_blocks: context.blocks.length,
    },
  };
}

/** One run: context, one call on the write tier of the Texte models, one usage event, the result. */
export async function runGeoTool(
  service: SupabaseClient,
  request: GeoToolRequest,
  options: { call?: GeoToolModelCall; timeoutMs?: number } = {},
): Promise<GeoToolResult> {
  const [context, models] = await Promise.all([loadGeoToolContext(service, request), loadContentModelConfig(service)]);
  const { result, usage } = await runGeoOnContext(context, { models: models.write, ...options });
  await recordLlmUsageEvent(service, {
    organisationId: request.organisationId,
    userId: request.userId,
    agentId: request.avatarId,
    mode: GEO_TOOL_USAGE_MODE,
    via: "direct",
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  }).catch((error: unknown) => console.warn("[text-tool.geo] usage not recorded:", error instanceof Error ? error.message : error));
  return result;
}
