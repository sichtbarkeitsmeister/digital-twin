/**
 * The DigitalTwin's suggestion of a page's Zielgruppen (`dt_content_pages.zielgruppen`): one short
 * call (model tier „check“) with the page's briefing, the profiles of the organisation's Zielgruppen
 * avatars and the Anbieterfakten. It answers primary (1–2) and secondary (0–3) avatars, each with a
 * one-sentence reason. Stored as `status: "vorschlag"`; the editor confirms or changes it. A page
 * with one Zielgruppe only gets it without a call. Usage `content.zielgruppen`, cost on the page.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadContentZielgruppenAvatars, type ContentAvatarRow } from "@/lib/dt/content/load-sources";
import { avatarFromAgent } from "@/lib/dt/content/mapping";
import { loadContentModelConfig } from "@/lib/dt/content/model-config-db";
import { callContentTool } from "@/lib/dt/content/pipeline/llm";
import { anbieterBlock, notesBlock, pageBlock, type ContentPipelineContext } from "@/lib/dt/content/pipeline/prompts";
import { loadContext } from "@/lib/dt/content/pipeline/run-step";
import { estimateCostEur, roundEur } from "@/lib/dt/content/pricing";
import { contentDbErrorMessage, isMissingZielgruppenColumnError, num, type ContentPageRow } from "@/lib/dt/content/store";
import { CONTENT_ZIELGRUPPEN_MIGRATION_FILE, normalizeZielgruppenLists, type ContentZielgruppen } from "@/lib/dt/content/zielgruppen";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";

export const ZIELGRUPPEN_USAGE_MODE = "content.zielgruppen";
const SUGGEST_TIMEOUT_MS = 60_000;
const SUGGEST_MAX_TOKENS = 1_500;
const PROFILE_CHARS = 2_500;
const ANBIETER_CHARS = 12_000;

export const ZIELGRUPPEN_SUGGEST_SYSTEM = `Du ordnest einer Seite einer Website die Zielgruppen des Anbieters zu. Du schreibst nichts für die Seite.
Primär: die Zielgruppe, die diese Seite hauptsächlich sucht und für die sie geschrieben wird – genau eine, höchstens zwei, wenn die Seite zwei Zielgruppen gleich stark anspricht.
Sekundär: Zielgruppen, die die Seite ebenfalls lesen und deren Fragen sie mitbeantworten sollte – keine bis drei.
Alle anderen: nicht zugeordnet.
Grundlage: Seitenname, Seitentyp, Keywords, Nutzerfragen, KI-Prompt und Anmerkungen der Seite, das Hauptsilo, die Profile der Zielgruppen und die Anbieterfakten. Eine Startseite oder Über-uns-Seite spricht meist mehrere Zielgruppen an, eine Leistungsseite meist eine.
Begründe jede Zuordnung in einem Satz, der sich auf diese Seite bezieht. Nichts erfinden.`;

/** The tool, with the organisation's avatar ids as the only allowed values. */
export function zielgruppenTool(ids: readonly string[]): Anthropic.Tool {
  const entry = {
    type: "object" as const,
    properties: {
      agent_id: { type: "string" as const, enum: [...ids], description: "id der Zielgruppe aus der Liste." },
      reason: { type: "string" as const, description: "Ein Satz, warum diese Zielgruppe zu dieser Seite gehört." },
    },
    required: ["agent_id", "reason"],
  };
  return {
    name: "submit_zielgruppen",
    description: "Primäre und sekundäre Zielgruppen dieser Seite, je mit Begründung.",
    input_schema: {
      type: "object",
      properties: {
        primary: { type: "array", items: entry, description: "Genau eine, höchstens zwei primäre Zielgruppen." },
        secondary: { type: "array", items: entry, description: "Keine bis drei sekundäre Zielgruppen." },
      },
      required: ["primary", "secondary"],
    },
  };
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()} …` : t;
}

/** The user message: the page, its notes, the Zielgruppen with their ids, the Anbieterfakten (shortened). */
export function zielgruppenSuggestPrompt(context: ContentPipelineContext, avatars: readonly ContentAvatarRow[]): string {
  const list = avatars.map((row) => {
    const a = avatarFromAgent(row);
    return [`### id: ${row.id}`, `Name: ${a.name}`, a.role ? `Rolle: ${a.role}` : "", clip(a.beschreibung, PROFILE_CHARS)].filter(Boolean).join("\n");
  });
  return [
    pageBlock(context),
    notesBlock(context),
    `## Zielgruppen des Anbieters\n${list.join("\n\n")}`,
    clip(anbieterBlock(context), ANBIETER_CHARS),
  ]
    .filter((part) => part.trim())
    .join("\n\n");
}

type Entry = { agent_id?: unknown; reason?: unknown };

/** The model's answer: known ids only, within the limits, with their reasons. */
export function normalizeZielgruppenAnswer(json: unknown, known: ReadonlySet<string>): Pick<ContentZielgruppen, "primary" | "secondary" | "reasons"> {
  const r = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const entries = (value: unknown): Entry[] => (Array.isArray(value) ? (value as Entry[]) : []);
  const reasons: Record<string, string> = {};
  const idsOf = (list: Entry[]) =>
    list
      .map((e) => {
        const id = typeof e?.agent_id === "string" ? e.agent_id.trim() : "";
        if (id && typeof e.reason === "string" && e.reason.trim() && !reasons[id]) reasons[id] = e.reason.trim().slice(0, 400);
        return id;
      })
      .filter(Boolean);
  const lists = normalizeZielgruppenLists(idsOf(entries(r.primary)), idsOf(entries(r.secondary)), known);
  const kept = new Set([...lists.primary, ...lists.secondary]);
  for (const id of Object.keys(reasons)) if (!kept.has(id)) delete reasons[id];
  return { ...lists, reasons };
}

export type ZielgruppenSuggestResult =
  | { ok: true; zielgruppen: ContentZielgruppen; cost_eur: number }
  | { ok: false; status: number; message: string };

/**
 * Suggests and stores the page's Zielgruppen. A confirmed choice is kept unless `force` („Neu
 * vorschlagen“). Never throws for a model problem: the reason comes back as a failure.
 */
export async function suggestContentZielgruppen(
  service: SupabaseClient,
  page: ContentPageRow,
  userId: string | null,
  options: {
    force?: boolean;
    now?: Date;
    callTool?: typeof callContentTool;
    models?: string[];
    /** Tests hand these in; the route loads them. */
    avatars?: ContentAvatarRow[];
    context?: ContentPipelineContext;
  } = {},
): Promise<ZielgruppenSuggestResult> {
  if (!page.zielgruppen) {
    return { ok: false, status: 409, message: `Zielgruppen je Seite brauchen die Migration ${CONTENT_ZIELGRUPPEN_MIGRATION_FILE} (einmal im Supabase SQL Editor ausführen).` };
  }
  if (page.zielgruppen.status === "bestaetigt" && page.zielgruppen.primary.length > 0 && !options.force) {
    return { ok: true, zielgruppen: page.zielgruppen, cost_eur: 0 };
  }
  const avatars = options.avatars ?? (await loadContentZielgruppenAvatars(service, page.organisation_id));
  if (avatars.length === 0) return { ok: false, status: 409, message: "Für diese Organisation gibt es keine Zielgruppen-Avatare (Agenten)." };
  const at = (options.now ?? new Date()).toISOString();
  let picked: Pick<ContentZielgruppen, "primary" | "secondary" | "reasons">;
  let costEur = 0;
  if (avatars.length === 1) {
    picked = { primary: [avatars[0]!.id], secondary: [], reasons: { [avatars[0]!.id]: "Einzige Zielgruppe des Anbieters." } };
  } else {
    let context: ContentPipelineContext;
    let avatarId: string | null = null;
    try {
      if (options.context) context = options.context;
      else ({ context, avatarId } = await loadContext(service, page, []));
    } catch (error) {
      return { ok: false, status: 409, message: error instanceof Error ? error.message : "Die Seite konnte nicht geladen werden." };
    }
    const ids = avatars.map((a) => a.id);
    try {
      const models = options.models ?? (await loadContentModelConfig(service)).check;
      const call = await (options.callTool ?? callContentTool)({
        models,
        system: ZIELGRUPPEN_SUGGEST_SYSTEM,
        user: zielgruppenSuggestPrompt(context, avatars),
        tool: zielgruppenTool(ids),
        maxTokens: SUGGEST_MAX_TOKENS,
        timeoutMs: SUGGEST_TIMEOUT_MS,
      });
      costEur = roundEur(estimateCostEur(call.model, call.usage));
      await recordLlmUsageEvent(service, {
        organisationId: page.organisation_id,
        userId,
        agentId: avatarId,
        mode: ZIELGRUPPEN_USAGE_MODE,
        via: "direct",
        model: call.model,
        inputTokens: call.usage.inputTokens,
        outputTokens: call.usage.outputTokens,
      });
      picked = normalizeZielgruppenAnswer(call.json, new Set(ids));
    } catch (error) {
      return { ok: false, status: 502, message: error instanceof Error ? error.message : "Der Vorschlag ist fehlgeschlagen." };
    }
    if (picked.primary.length === 0) {
      return { ok: false, status: 422, message: "Der Zwilling hat keine primäre Zielgruppe vorgeschlagen. Bitte von Hand festlegen." };
    }
  }
  const zielgruppen: ContentZielgruppen = { ...picked, status: "vorschlag", suggested_at: at, confirmed_at: null };
  const { error } = await service
    .from("dt_content_pages")
    .update({ zielgruppen, cost_eur: roundEur(num(page.cost_eur) + costEur) })
    .eq("id", page.id);
  if (error) {
    if (isMissingZielgruppenColumnError(error)) {
      return { ok: false, status: 409, message: `Zielgruppen je Seite brauchen die Migration ${CONTENT_ZIELGRUPPEN_MIGRATION_FILE} (einmal im Supabase SQL Editor ausführen).` };
    }
    return { ok: false, status: 500, message: contentDbErrorMessage(error, "Zielgruppen konnten nicht gespeichert werden") };
  }
  return { ok: true, zielgruppen, cost_eur: costEur };
}

/**
 * The editor's choice („Bestätigen“ or a moved switch): checked against the organisation's
 * Zielgruppen, stored as confirmed. An empty primary list clears the page's own Zielgruppen
 * (it runs with the Standard-Zielgruppe again).
 */
export async function saveContentZielgruppen(
  service: SupabaseClient,
  page: ContentPageRow,
  input: { primary: string[]; secondary: string[] },
  options: { now?: Date; avatars?: ContentAvatarRow[] } = {},
): Promise<{ ok: true; zielgruppen: ContentZielgruppen } | { ok: false; status: number; message: string }> {
  if (!page.zielgruppen) {
    return { ok: false, status: 409, message: `Zielgruppen je Seite brauchen die Migration ${CONTENT_ZIELGRUPPEN_MIGRATION_FILE} (einmal im Supabase SQL Editor ausführen).` };
  }
  const avatars = options.avatars ?? (await loadContentZielgruppenAvatars(service, page.organisation_id));
  const known = new Set(avatars.map((a) => a.id));
  const unknown = [...input.primary, ...input.secondary].filter((id) => !known.has(id));
  if (unknown.length > 0) return { ok: false, status: 400, message: "Diese Zielgruppe gibt es (nicht mehr). Bitte die Seite neu laden." };
  const lists = normalizeZielgruppenLists(input.primary, input.secondary, known);
  const at = (options.now ?? new Date()).toISOString();
  const zielgruppen: ContentZielgruppen =
    lists.primary.length === 0
      ? { primary: [], secondary: [], status: "vorschlag", reasons: {}, suggested_at: null, confirmed_at: null }
      : { ...lists, status: "bestaetigt", reasons: page.zielgruppen.reasons, suggested_at: page.zielgruppen.suggested_at, confirmed_at: at };
  const { error } = await service.from("dt_content_pages").update({ zielgruppen }).eq("id", page.id);
  if (error) return { ok: false, status: 500, message: contentDbErrorMessage(error, "Zielgruppen konnten nicht gespeichert werden") };
  return { ok: true, zielgruppen };
}
