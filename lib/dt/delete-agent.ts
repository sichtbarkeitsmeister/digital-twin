import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  deleteDtAgentErrorCode,
  isProtectedSeoAdvisorAgent,
} from "@/lib/dt/delete-agent-policy";

export {
  deleteDtAgentErrorCode,
  deleteDtAgentUserMessage,
  isProtectedSeoAdvisorAgent,
} from "@/lib/dt/delete-agent-policy";

/**
 * Delete an org agent. Only the SEO advisor is undeletable.
 * Falls back to a service-role delete when the DB RPC still blocks all
 * `is_default` rows (stale `dt_delete_agent` before the Standard-Avatar fix).
 */
export async function deleteDtAgent(
  agentId: string,
): Promise<{ ok: boolean; error: string | null }> {
  const supabase = await createClient();
  const { data: agent, error: loadError } = await supabase
    .from("dt_agents")
    .select("id,organisation_id,slug,kind,name,is_default,is_enabled")
    .eq("id", agentId)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!agent?.organisation_id) return { ok: false, error: "agent_not_found" };

  if (isProtectedSeoAdvisorAgent(agent)) {
    return { ok: false, error: "seo_advisor_protected" };
  }

  const { error: rpcError } = await supabase.rpc("dt_delete_agent", {
    p_agent_id: agentId,
  });
  if (!rpcError) return { ok: true, error: null };

  const code = deleteDtAgentErrorCode(rpcError.message);
  // Stale RPC: protected every is_default agent and labeled it like SEO.
  // For non-SEO agents (e.g. Standard-Avatar), finish the delete ourselves.
  if (code === "default_agent_protected" || code === "seo_advisor_protected") {
    return deleteDtAgentViaService({
      agentId,
      organisationId: agent.organisation_id,
    });
  }

  return { ok: false, error: rpcError.message };
}

async function deleteDtAgentViaService(input: {
  agentId: string;
  organisationId: string;
}): Promise<{ ok: boolean; error: string | null }> {
  const service = createServiceClient();

  const { data: agent } = await service
    .from("dt_agents")
    .select("id,slug,kind")
    .eq("id", input.agentId)
    .maybeSingle();

  if (!agent) return { ok: false, error: "agent_not_found" };
  if (isProtectedSeoAdvisorAgent(agent)) {
    return { ok: false, error: "seo_advisor_protected" };
  }

  const { count: enabledOthers, error: enabledError } = await service
    .from("dt_agents")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", input.organisationId)
    .eq("is_enabled", true)
    .neq("id", input.agentId);

  if (enabledError) return { ok: false, error: enabledError.message };
  if ((enabledOthers ?? 0) < 1) return { ok: false, error: "last_enabled_agent" };

  const { count: chatCount, error: chatError } = await service
    .from("dt_chats")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", input.agentId);

  if (chatError) return { ok: false, error: chatError.message };
  if ((chatCount ?? 0) > 0) return { ok: false, error: "agent_has_chats" };

  const { error: deleteError } = await service.from("dt_agents").delete().eq("id", input.agentId);
  if (deleteError) return { ok: false, error: deleteError.message };
  return { ok: true, error: null };
}
