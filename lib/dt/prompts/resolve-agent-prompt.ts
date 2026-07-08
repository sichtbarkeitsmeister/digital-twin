import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_FALLBACK = "Du bist ein hilfreicher Assistent.";
const ORG_PLACEHOLDER = /\{\{\s*organisation\s*\}\}/gi;

export type DtResolvablePromptAgent = {
  prompt_template?: string | null;
  uses_global_prompt?: boolean | null;
  template_id?: string | null;
  kind?: string | null;
  slug?: string | null;
};

function slugForGlobalTemplate(agent: DtResolvablePromptAgent): string | null {
  if (agent.slug === "seo_advisor" || agent.kind === "seo_advisor") return "seo_advisor";
  if (agent.slug === "default" || agent.kind === "persona") return "default";
  return null;
}

/**
 * Resolves the effective system prompt for an agent. Agents flagged with
 * `uses_global_prompt` read their prompt live from `dt_agent_templates`
 * (single global source), substituting `{{organisation}}` with the org name.
 * All other agents use their own per-org `prompt_template`.
 */
export async function resolveDtAgentPrompt(
  supabase: SupabaseClient,
  agent: DtResolvablePromptAgent,
  orgName: string,
): Promise<string> {
  const own = agent.prompt_template?.trim() || DEFAULT_FALLBACK;

  if (!agent.uses_global_prompt) return own;

  let globalPrompt: string | null = null;

  if (agent.template_id) {
    const { data } = await supabase
      .from("dt_agent_templates")
      .select("default_prompt")
      .eq("id", agent.template_id)
      .maybeSingle();
    globalPrompt = data?.default_prompt ?? null;
  }

  if (!globalPrompt) {
    const slug = slugForGlobalTemplate(agent);
    if (slug) {
      const { data } = await supabase
        .from("dt_agent_templates")
        .select("default_prompt")
        .eq("slug", slug)
        .maybeSingle();
      globalPrompt = data?.default_prompt ?? null;
    }
  }

  const resolved = globalPrompt?.trim();
  if (!resolved) return own;

  return resolved.replace(ORG_PLACEHOLDER, orgName);
}
