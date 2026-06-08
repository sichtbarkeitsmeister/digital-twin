import { createClient } from "@/lib/supabase/server";

import type { DtAgentRow, DtChatMode, DtChatRow, DtMessageRow, DtOrgConfigRow } from "@/lib/dt/types";

export async function requireAuthUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.id) return { ok: false as const, supabase, userId: null };
  return { ok: true as const, supabase, userId: user.id };
}

export async function loadAgentsForOrg(organisationId: string): Promise<DtAgentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("dt_agents")
    .select("id,organisation_id,slug,name,role,kind,quick_actions,is_enabled,position")
    .eq("organisation_id", organisationId)
    .eq("is_enabled", true)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as DtAgentRow[];
}

export async function loadOrgConfig(organisationId: string): Promise<DtOrgConfigRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("dt_org_config")
    .select(
      "organisation_id,display_name,twin_provisioned,seo_enabled,disabled,website_url,footer_url,ga4_property_id,ga4_account,gsc_site_url,gsc_account,sistrix_domain,sitemap_url,focus_keyword,report_recipient_email,report_timeframe,seo_checklist,videos",
    )
    .eq("organisation_id", organisationId)
    .maybeSingle();
  return data as DtOrgConfigRow | null;
}

export async function queueDtSeoReport(params: {
  organisationId: string;
  recipientType: "intern" | "kunde";
}): Promise<{ reportId: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dt_queue_seo_report", {
    p_organisation_id: params.organisationId,
    p_recipient_type: params.recipientType,
  });
  if (error) return { reportId: null, error: error.message };
  const reportId = typeof data === "string" ? data : null;
  return { reportId, error: reportId ? null : "Report konnte nicht angelegt werden." };
}

export async function getDtChatOrNull(chatId: string): Promise<DtChatRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("dt_chats")
    .select(
      "id,organisation_id,agent_id,mode,owner_user_id,title,archived_at,pinned,created_at,updated_at",
    )
    .eq("id", chatId)
    .maybeSingle();
  return data as DtChatRow | null;
}

export type DtChatListScope = "mine" | "team" | "all";

export async function listDtChats(params: {
  organisationId: string;
  scope: DtChatListScope;
  userId: string;
  includeArchived?: boolean;
  chatMode?: DtChatMode;
}): Promise<DtChatRow[]> {
  const supabase = await createClient();
  const modeFilter = params.chatMode ?? "default";
  let q = supabase
    .from("dt_chats")
    .select(
      "id,organisation_id,agent_id,mode,owner_user_id,title,archived_at,pinned,created_at,updated_at",
    )
    .eq("organisation_id", params.organisationId)
    .order("updated_at", { ascending: false });

  if (params.scope === "mine" && modeFilter === "seo") {
    q = q.eq("mode", "seo");
  } else if (params.scope === "mine") {
    q = q.eq("mode", modeFilter).eq("owner_user_id", params.userId);
  } else if (params.scope === "team") {
    q = q.eq("mode", "team");
  } else if (modeFilter === "seo") {
    q = q.eq("mode", "seo").eq("owner_user_id", params.userId);
  } else {
    q = q.or(
      `and(mode.eq.default,owner_user_id.eq.${params.userId}),mode.eq.team`,
    );
  }

  if (!params.includeArchived) q = q.is("archived_at", null);

  const { data } = await q;
  return (data ?? []) as DtChatRow[];
}

export async function loadAgentsForOrgManage(organisationId: string): Promise<
  Array<
    DtAgentRow & {
      template_id: string | null;
      prompt_template: string;
    }
  >
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("dt_agents")
    .select(
      "id,organisation_id,template_id,slug,name,role,kind,quick_actions,is_enabled,position,prompt_template",
    )
    .eq("organisation_id", organisationId)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as Array<
    DtAgentRow & { template_id: string | null; prompt_template: string }
  >;
}

export async function subscribeDtAgentTemplate(params: {
  organisationId: string;
  templateId: string;
  overrides?: Record<string, unknown>;
}): Promise<{ agentId: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dt_subscribe_agent_template", {
    p_organisation_id: params.organisationId,
    p_template_id: params.templateId,
    p_overrides: params.overrides ?? {},
  });
  if (error) return { agentId: null, error: error.message };
  const agentId = typeof data === "string" ? data : null;
  return { agentId, error: agentId ? null : "Agent konnte nicht angelegt werden." };
}

export async function createDtPersonaAgent(params: {
  organisationId: string;
  payload: Record<string, unknown>;
}): Promise<{ agentId: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dt_create_persona_agent", {
    p_organisation_id: params.organisationId,
    p_payload: params.payload,
  });
  if (error) return { agentId: null, error: error.message };
  const agentId = typeof data === "string" ? data : null;
  return { agentId, error: agentId ? null : "Agent konnte nicht angelegt werden." };
}

export async function updateDtAgent(params: {
  agentId: string;
  patch: Record<string, unknown>;
}): Promise<{ ok: boolean; error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("dt_update_agent", {
    p_agent_id: params.agentId,
    p_patch: params.patch,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}

export async function deleteDtAgent(agentId: string): Promise<{ ok: boolean; error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("dt_delete_agent", { p_agent_id: agentId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}

export async function createDtChat(params: {
  organisationId: string;
  agentId: string;
  mode: DtChatMode;
  title?: string | null;
}): Promise<{ chatId: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dt_create_chat", {
    p_organisation_id: params.organisationId,
    p_agent_id: params.agentId,
    p_mode: params.mode,
    p_title: params.title ?? null,
  });

  if (error) return { chatId: null, error: error.message };
  const chatId = typeof data === "string" ? data : null;
  return { chatId, error: chatId ? null : "Chat konnte nicht erstellt werden." };
}

export async function loadDtMessages(chatId: string): Promise<DtMessageRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("dt_chat_messages")
    .select("id,chat_id,role,content,metadata,author_user_id,stopped,created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  return (data ?? []) as DtMessageRow[];
}

export async function loadAgentById(agentId: string): Promise<DtAgentRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("dt_agents")
    .select("id,organisation_id,slug,name,role,kind,quick_actions,is_enabled,position,prompt_template")
    .eq("id", agentId)
    .maybeSingle();
  return data as (DtAgentRow & { prompt_template?: string }) | null;
}
