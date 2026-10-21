/**
 * The Mix generator under Agenten: one model call with the saved „Mix-Avatar“ prompt as system
 * and the selected Zielgruppen avatars (name, role, avatar part) as user message. The result is
 * tidied and checked like an avatar of the Avatar-Plan; a broken rule gets exactly one new run
 * with the errors in the user message, then a German error and nothing is saved. The model call
 * is passed in (`workshop-llm.ts` passes the real one) and Supabase only reaches `saveMixAgent`,
 * so everything here is testable without either.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import { reviveStringifiedToolInput } from "@/lib/ai/tolerant-json";
import { avatarSpecificText } from "@/lib/dt/agents/avatar-text";
import {
  MIX_AGENT_NAME,
  MIX_AGENT_SLUG,
  MIX_SOURCES_MAX,
  MIX_SOURCES_MIN,
  findMixAgent,
  isMixAgent,
  isZielgruppenAvatar,
  mixRole,
  type MixInfo,
} from "@/lib/dt/agents/mix";
import {
  AVATAR_GLOBAL_PROMPT_ANCHOR_HEADING,
  ensureAvatarGlobalPromptAnchor,
} from "@/lib/dt/prompts/avatar-global-prompt-anchor";
import {
  AVATAR_QUICK_ACTIONS_MAX,
  AVATAR_QUICK_ACTIONS_MIN,
  dashErrors,
  placeholderErrors,
  quickActionErrors,
  requiredHeadingErrors,
  tidyAvatarPromptTemplate,
} from "@/lib/dt/transcripts/avatar-generator";
import type { WorkshopToolCall } from "@/lib/dt/transcripts/avatar-plan-llm";
import { isMissingAgentError } from "@/lib/dt/transcripts/workshop-model";

/** Token usage of the Mix in Token-Nutzung. */
export const MIX_USAGE_MODE = "agents.mix";

/** The blocks of the Mix part, all required, in this order (as in the default „Mix-Avatar“ prompt). */
export const MIX_REQUIRED_HEADINGS = [
  "ANKER: GLOBALER DIGITALTWIN-PROMPT",
  "ANREDE",
  "WER DU BIST",
  "EURE GEMEINSAME SITUATION",
  "EUER GEMEINSAMES ZIEL",
  "WAS EUCH BELASTET",
  "WAS VOM ANFRAGEN ABHÄLT",
  "TYPISCHE FRAGEN",
  "EINWÄNDE UND BEDENKEN",
  "WAS EUCH ÜBERZEUGT",
  "ENTSCHEIDUNG UND ZEITRAHMEN",
  "WO SICH DIE ZIELGRUPPEN UNTERSCHEIDEN",
  "DEINE SPRACHE",
] as const;

/** The columns of `dt_agents` the Mix reads. */
export const MIX_AGENT_SELECT =
  "id,name,role,kind,slug,is_enabled,is_default,uses_global_prompt,prompt_template,prompt_append,avatar_data";

export type MixAgentRow = {
  id: string;
  name: string;
  role: string | null;
  kind: string;
  slug: string | null;
  is_enabled: boolean;
  is_default: boolean | null;
  uses_global_prompt: boolean | null;
  prompt_template: string | null;
  prompt_append: string | null;
  avatar_data: unknown;
};

/** One selected avatar as the generator sees it. */
export type MixSource = {
  id: string;
  name: string;
  role: string | null;
  text: string;
};

export type MixResult = {
  promptTemplate: string;
  quickActions: string[];
  icon: string;
};

/** The ERGEBNIS of the default prompt as a tool. */
export const MIX_TOOL: Anthropic.Tool = {
  name: "submit_mix",
  description: "Das Ergebnis des Mix: prompt_template, quick_actions und icon.",
  input_schema: {
    type: "object",
    properties: {
      prompt_template: {
        type: "string",
        description: "Der Mix-Teil als Markdown, beginnend mit ## ANKER: GLOBALER DIGITALTWIN-PROMPT.",
      },
      quick_actions: {
        type: "array",
        minItems: AVATAR_QUICK_ACTIONS_MIN,
        maxItems: AVATAR_QUICK_ACTIONS_MAX,
        items: { type: "string" },
        description: "4 bis 6, aus Sicht des Mitarbeiters, passend für alle Zielgruppen. Keine beginnt mit Ich, Mir, Mich oder Mein.",
      },
      icon: { type: "string", description: "Ein Emoji." },
    },
    required: ["prompt_template", "quick_actions", "icon"],
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export type MixSourceSelection =
  | { ok: true; sources: MixSource[]; mix: MixAgentRow | null }
  | { ok: false; message: string };

/**
 * The avatars a Mix is built from, checked against all agents of the organisation: an id of
 * another organisation or of a deleted agent is refused, the Mix itself is skipped, anything
 * else that is not an enabled Zielgruppen avatar is refused, and at least two must remain.
 * The order is the organisation's list order. Also returns the existing Mix, if any.
 */
export function selectMixSources(agents: readonly MixAgentRow[], requestedIds: readonly string[]): MixSourceSelection {
  const known = new Set(agents.map((agent) => agent.id));
  const unknown = [...new Set(requestedIds)].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      message:
        unknown.length === 1
          ? "Ein ausgewählter Avatar gehört nicht zu dieser Organisation oder existiert nicht mehr."
          : `${unknown.length} ausgewählte Avatare gehören nicht zu dieser Organisation oder existieren nicht mehr.`,
    };
  }
  const requested = new Set(requestedIds);
  const picked = agents.filter((agent) => requested.has(agent.id) && !isMixAgent(agent));
  const invalid = picked.filter((agent) => agent.is_enabled === false || !isZielgruppenAvatar(agent));
  if (invalid.length > 0) {
    return {
      ok: false,
      message: `Kein aktiver Zielgruppen-Avatar: ${invalid.map((agent) => `„${agent.name}“`).join(", ")}.`,
    };
  }
  if (picked.length < MIX_SOURCES_MIN) return { ok: false, message: "Mindestens zwei Zielgruppen-Avatare auswählen." };
  if (picked.length > MIX_SOURCES_MAX) {
    return { ok: false, message: `Höchstens ${MIX_SOURCES_MAX} Zielgruppen-Avatare auswählen.` };
  }
  return {
    ok: true,
    mix: findMixAgent(agents),
    sources: picked.map((agent) => ({ id: agent.id, name: agent.name, role: agent.role, text: avatarSpecificText(agent) })),
  };
}

/** The user message: each selected avatar with name, role and avatar part; on the retry also the broken rules. */
export function buildMixUserMessage(input: {
  sources: readonly MixSource[];
  previousErrors?: readonly string[];
}): string {
  const avatars = input.sources.map((source, index) =>
    [
      `<avatar nummer="${index + 1}">`,
      `Name: ${source.name.trim()}`,
      `Rolle: ${source.role?.trim() || "keine Angabe"}`,
      "Avatar-Text:",
      source.text.trim() || "(kein Avatar-Text gespeichert)",
      "</avatar>",
    ].join("\n"),
  );
  const errors = input.previousErrors ?? [];
  return [
    `Die ${input.sources.length} ausgewählten Zielgruppen-Avatare:`,
    ...avatars,
    errors.length > 0
      ? [
          "Dein letztes Ergebnis wurde nicht gespeichert. Diese Regeln waren verletzt, behebe sie:",
          ...errors.map((error) => `- ${error}`),
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The tool input as a Mix result; typography the model keeps getting wrong is fixed first. */
export function normalizeMixResult(raw: unknown): MixResult {
  // Claude sometimes sends the Quick Actions as a JSON string; read them back as the declared array.
  const record =
    asRecord(reviveStringifiedToolInput(raw, MIX_TOOL.input_schema as Parameters<typeof reviveStringifiedToolInput>[1])) ??
    {};
  const quick = record.quick_actions ?? record.quickActions;
  return {
    promptTemplate: tidyAvatarPromptTemplate(text(record.prompt_template ?? record.promptTemplate, 60_000)),
    quickActions: Array.isArray(quick) ? quick.map((item) => text(item, 160)).filter(Boolean).slice(0, 12) : [],
    icon: text(record.icon, 16),
  };
}

/**
 * The rules a Mix must pass before it is saved; the errors in German (empty when it passes).
 * Starts with the anchor heading, has every Mix block in order, no placeholder in brackets,
 * no „–“ or „—“, and 4 to 6 Quick Actions, none from the persona's view.
 */
export function validateMixResult(result: MixResult): string[] {
  const prompt = result.promptTemplate.trim();
  if (!prompt) return ["Die KI hat keinen Mix-Text (prompt_template) geliefert."];
  const errors: string[] = [];
  if (!prompt.startsWith(AVATAR_GLOBAL_PROMPT_ANCHOR_HEADING)) {
    errors.push(`Der Mix-Text beginnt nicht mit „${AVATAR_GLOBAL_PROMPT_ANCHOR_HEADING}“.`);
  }
  errors.push(
    ...requiredHeadingErrors(prompt, MIX_REQUIRED_HEADINGS),
    ...placeholderErrors(prompt),
    ...dashErrors(prompt),
    ...quickActionErrors(result.quickActions),
  );
  return errors;
}

/** What the Agenten page shows when the Mix still breaks a rule after its second run. */
export function mixRuleFailureMessage(errors: readonly string[]): string {
  const shown = errors.slice(0, 5).join(" ");
  return `Der Mix wurde nicht gespeichert, weil das Ergebnis gegen Regeln verstößt: ${shown}${errors.length > 5 ? " …" : ""} Bitte erneut versuchen.`;
}

export type CheckedMix = {
  result: MixResult;
  /** Errors still open after the last run; empty when the result may be saved. */
  errors: string[];
  runs: number;
  usage: { inputTokens: number; outputTokens: number };
  model: string | null;
};

/**
 * The generator with its check: one run, and when a rule is broken one more run with the errors
 * in the user message (unless `deadline` has passed). Saving happens in `saveMixAgent`.
 */
export async function generateCheckedMixWith(input: {
  system: string;
  sources: readonly MixSource[];
  call: WorkshopToolCall;
  /** No second run starts after this time (ms since epoch); keeps the request within its limit. */
  deadline?: number;
  now?: () => number;
}): Promise<CheckedMix> {
  const now = input.now ?? Date.now;
  const usage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let result: MixResult = { promptTemplate: "", quickActions: [], icon: "" };
  let errors: string[] = [];
  let runs = 0;
  while (runs < 2) {
    if (runs > 0 && input.deadline != null && now() >= input.deadline) break;
    runs += 1;
    const response = await input.call({
      system: input.system,
      user: buildMixUserMessage({ sources: input.sources, previousErrors: errors }),
      tool: MIX_TOOL,
      maxTokens: 16_000,
    });
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    model = response.model ?? model;
    result = normalizeMixResult(response.json);
    errors = validateMixResult(result);
    if (errors.length === 0) break;
  }
  return { result, errors, runs, usage, model };
}

export type SaveMixOutcome =
  | { ok: true; agentId: string; created: boolean }
  | { ok: false; message: string };

/**
 * Writes a checked Mix: updates the existing Mix in place (same id, so its chats stay; name and
 * on/off stay as the team set them) or creates it with slug `mix`. A Mix deleted meanwhile is
 * created anew.
 */
export async function saveMixAgent(input: {
  supabase: SupabaseClient;
  organisationId: string;
  existing: Pick<MixAgentRow, "id" | "avatar_data"> | null;
  result: MixResult;
  sources: ReadonlyArray<Pick<MixSource, "id" | "name">>;
  /** When the sources were read; a source changed after it marks the Mix as outdated. */
  generatedAt: string;
}): Promise<SaveMixOutcome> {
  const mix: MixInfo = {
    sourceAgentIds: input.sources.map((source) => source.id),
    sourceNames: input.sources.map((source) => source.name),
    generatedAt: input.generatedAt,
  };
  const icon = input.result.icon ? { icon: input.result.icon } : {};
  const role = mixRole(input.sources.length);
  const promptAppend = ensureAvatarGlobalPromptAnchor(input.result.promptTemplate);

  if (input.existing) {
    const { error } = await input.supabase.rpc("dt_update_agent", {
      p_agent_id: input.existing.id,
      p_patch: {
        role,
        prompt_append: promptAppend,
        quick_actions: input.result.quickActions,
        avatar_data: { ...(asRecord(input.existing.avatar_data) ?? {}), mix, ...icon },
        uses_global_prompt: true,
      },
    });
    if (!error) return { ok: true, agentId: input.existing.id, created: false };
    if (!isMissingAgentError(error.message)) {
      return { ok: false, message: `Der Mix konnte nicht gespeichert werden: ${error.message}` };
    }
  }

  const { data, error } = await input.supabase.rpc("dt_create_persona_agent", {
    p_organisation_id: input.organisationId,
    p_payload: {
      slug: MIX_AGENT_SLUG,
      name: MIX_AGENT_NAME,
      role,
      prompt_template: `Avatar: ${MIX_AGENT_NAME}`,
      prompt_append: promptAppend,
      uses_global_prompt: true,
      avatar_data: { mix, ...icon },
      quick_actions: input.result.quickActions,
      is_enabled: true,
    },
  });
  if (error) {
    return {
      ok: false,
      message: /agent_slug_exists/.test(error.message)
        ? "Inzwischen gibt es schon einen Mix. Bitte die Seite neu laden und „Mix neu erstellen“ nutzen."
        : `Der Mix konnte nicht angelegt werden: ${error.message}`,
    };
  }
  const agentId = typeof data === "string" ? data : null;
  return agentId ? { ok: true, agentId, created: true } : { ok: false, message: "Der Mix konnte nicht angelegt werden." };
}
