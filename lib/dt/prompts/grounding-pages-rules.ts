import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isDefaultGroundingModeInstructions,
  resolveGroundingModeInstructions,
} from "@/lib/dt/prompts/grounding-mode";
import {
  isDefaultGroundingAgentBase,
  isDefaultGroundingAgentStandard,
  resolveGroundingAgentRules,
} from "@/lib/dt/seo/grounding-run/prompts";

export const GROUNDING_PAGES_RULES_MIGRATION =
  "database/migrations/20261013_dt_grounding_pages_prompt.sql";

export const GROUNDING_PAGES_RULES_MIGRATION_MESSAGE =
  `Die Regeln lassen sich speichern, sobald ${GROUNDING_PAGES_RULES_MIGRATION} im Supabase SQL Editor ausgeführt wurde. Bis dahin gilt der hinterlegte Standard.`;

export const GROUNDING_RULES_MAX_CHARS = 100_000;

export type GroundingPagesRulesState = {
  modePrompt: string;
  agentBase: string;
  agentStandard: string;
  modeIsDefault: boolean;
  agentBaseIsDefault: boolean;
  agentStandardIsDefault: boolean;
  /** False when the columns are not in the database yet. */
  persisted: boolean;
  message: string | null;
};

function missingColumn(message: string): boolean {
  return (
    /grounding_mode_prompt|grounding_agent_base_prompt|grounding_agent_standard_prompt|schema cache/i.test(
      message,
    ) && /does not exist|schema cache/i.test(message)
  );
}

function storedText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function groundingRulesAreDefault(
  state: Pick<
    GroundingPagesRulesState,
    "modeIsDefault" | "agentBaseIsDefault" | "agentStandardIsDefault"
  >,
): boolean {
  return state.modeIsDefault && state.agentBaseIsDefault && state.agentStandardIsDefault;
}

export function formatGroundingRulesPreview(state: GroundingPagesRulesState): string {
  return [
    "## SEO-Chat (Schalter „Grounding Page“)",
    state.modePrompt,
    "",
    "## Grundregeln des Grounding-Agenten",
    state.agentBase,
    "",
    "## Pflichtblöcke der Seite",
    state.agentStandard,
  ].join("\n");
}

export async function loadGroundingPagesRules(
  supabase: SupabaseClient,
): Promise<GroundingPagesRulesState> {
  const { data, error } = await supabase
    .from("dt_platform_settings")
    .select("grounding_mode_prompt, grounding_agent_base_prompt, grounding_agent_standard_prompt")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    const fallback = emptyState(missingColumn(error.message) ? GROUNDING_PAGES_RULES_MIGRATION_MESSAGE : null);
    if (!missingColumn(error.message)) {
      console.warn("[dt/grounding-pages] rules:", error.message);
    }
    return fallback;
  }

  const mode = storedText(data?.grounding_mode_prompt);
  const base = storedText(data?.grounding_agent_base_prompt);
  const standard = storedText(data?.grounding_agent_standard_prompt);
  const agent = resolveGroundingAgentRules({ base, standard });
  return {
    modePrompt: resolveGroundingModeInstructions(mode),
    agentBase: agent.base,
    agentStandard: agent.standard,
    modeIsDefault: isDefaultGroundingModeInstructions(mode),
    agentBaseIsDefault: isDefaultGroundingAgentBase(base),
    agentStandardIsDefault: isDefaultGroundingAgentStandard(standard),
    persisted: true,
    message: null,
  };
}

function emptyState(message: string | null): GroundingPagesRulesState {
  const agent = resolveGroundingAgentRules(null);
  return {
    modePrompt: resolveGroundingModeInstructions(null),
    agentBase: agent.base,
    agentStandard: agent.standard,
    modeIsDefault: true,
    agentBaseIsDefault: true,
    agentStandardIsDefault: true,
    persisted: false,
    message,
  };
}
