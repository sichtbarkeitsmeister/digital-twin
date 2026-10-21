import type { SupabaseClient } from "@supabase/supabase-js";

import { MIX_PROMPT_SLUG, resolveMixPrompt } from "@/lib/dt/agents/mix-prompt";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The saved „Mix-Avatar“ prompt with the organisation filled in. Read with the service client,
 * like „Anbieter-Avatare“: the template row is not public. Any problem (no row, migration not
 * run) means the default from code, never a failed Mix. `client` is only passed by tests.
 */
export async function loadMixPrompt(organisationName: string, client?: SupabaseClient): Promise<string> {
  try {
    const supabase = client ?? createServiceClient();
    const { data, error } = await supabase
      .from("dt_agent_templates")
      .select("default_prompt")
      .eq("slug", MIX_PROMPT_SLUG)
      .maybeSingle();
    if (error) {
      console.warn("[dt] loadMixPrompt:", error.message);
      return resolveMixPrompt(null, organisationName);
    }
    return resolveMixPrompt((data?.default_prompt as string | null | undefined) ?? null, organisationName);
  } catch (err) {
    console.warn("[dt] loadMixPrompt:", err);
    return resolveMixPrompt(null, organisationName);
  }
}
