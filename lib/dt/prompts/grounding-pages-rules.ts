import type { SupabaseClient } from "@supabase/supabase-js";

import {
  defaultGroundingPagesRules,
  isDefaultGroundingPagesRules,
  resolveGroundingPagesRules,
} from "@/lib/dt/prompts/grounding-pages-prompt";

export const GROUNDING_PAGES_RULES_MIGRATION =
  "database/migrations/20261013_dt_grounding_pages_prompt.sql";

export const GROUNDING_PAGES_RULES_MIGRATION_MESSAGE =
  `Die Regeln lassen sich speichern, sobald ${GROUNDING_PAGES_RULES_MIGRATION} im Supabase SQL Editor ausgeführt wurde. Bis dahin gilt der hinterlegte Standard.`;

export type GroundingPagesRulesState = {
  prompt: string;
  isDefault: boolean;
  /** False when the column is not in the database yet. */
  persisted: boolean;
  message: string | null;
};

function missingColumn(message: string): boolean {
  return /grounding_pages_prompt|schema cache|does not exist/i.test(message);
}

export async function loadGroundingPagesRules(
  supabase: SupabaseClient,
): Promise<GroundingPagesRulesState> {
  const { data, error } = await supabase
    .from("dt_platform_settings")
    .select("grounding_pages_prompt")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    if (missingColumn(error.message)) {
      return {
        prompt: defaultGroundingPagesRules(),
        isDefault: true,
        persisted: false,
        message: GROUNDING_PAGES_RULES_MIGRATION_MESSAGE,
      };
    }
    console.warn("[dt/grounding-pages] rules:", error.message);
    return {
      prompt: defaultGroundingPagesRules(),
      isDefault: true,
      persisted: false,
      message: null,
    };
  }

  const stored =
    typeof data?.grounding_pages_prompt === "string" ? data.grounding_pages_prompt : null;
  return {
    prompt: resolveGroundingPagesRules(stored),
    isDefault: isDefaultGroundingPagesRules(stored),
    persisted: true,
    message: null,
  };
}
