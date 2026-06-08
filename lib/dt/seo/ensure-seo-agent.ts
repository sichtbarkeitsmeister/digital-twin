import type { SupabaseClient } from "@supabase/supabase-js";

/** Ensures org has an enabled seo_advisor agent; subscribes template if missing. */
export async function ensureSeoAdvisorAgent(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<{ agentId: string | null; error: string | null }> {
  const { data: existing } = await supabase
    .from("dt_agents")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("kind", "seo_advisor")
    .eq("is_enabled", true)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return { agentId: existing.id, error: null };

  const { data: tpl } = await supabase
    .from("dt_agent_templates")
    .select("id")
    .eq("slug", "seo_advisor")
    .is("archived_at", null)
    .maybeSingle();

  if (!tpl?.id) {
    return { agentId: null, error: "SEO-Berater-Vorlage fehlt." };
  }

  const { data, error } = await supabase.rpc("dt_subscribe_agent_template", {
    p_organisation_id: organisationId,
    p_template_id: tpl.id,
    p_overrides: {},
  });

  if (error) {
    if (error.message.includes("agent_slug_exists")) {
      const { data: again } = await supabase
        .from("dt_agents")
        .select("id")
        .eq("organisation_id", organisationId)
        .eq("slug", "seo_advisor")
        .maybeSingle();
      return { agentId: again?.id ?? null, error: null };
    }
    return { agentId: null, error: error.message };
  }

  const agentId = typeof data === "string" ? data : null;
  return { agentId, error: agentId ? null : "Agent konnte nicht angelegt werden." };
}
