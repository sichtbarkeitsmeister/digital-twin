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
    .select("id,organisation_id,slug,name,role,kind,quick_actions,is_enabled,position,avatar_data")
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
      "organisation_id,display_name,twin_provisioned,seo_enabled,disabled,website_url,footer_url,ga4_property_id,ga4_account,gsc_site_url,gsc_account,sistrix_domain,sitemap_url,focus_keyword,report_recipient_email,report_timeframe,seo_checklist,seo_checklist_personalized,videos",
    )
    .eq("organisation_id", organisationId)
    .maybeSingle();
  return data as DtOrgConfigRow | null;
}

export async function queueDtSeoReport(params: {
  organisationId: string;
  recipientType: "intern" | "kunde";
  sendToOwner?: boolean;
}): Promise<{ reportId: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dt_queue_seo_report", {
    p_organisation_id: params.organisationId,
    p_recipient_type: params.recipientType,
    p_send_to_owner: params.sendToOwner ?? false,
  });
  if (error) return { reportId: null, error: error.message };
  const reportId = typeof data === "string" ? data : null;
  return { reportId, error: reportId ? null : "Report konnte nicht angelegt werden." };
}

export async function getDtChatOrNull(chatId: string): Promise<DtChatRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("dt_chats")
    .select(DT_CHAT_LIST_SELECT)
    .eq("id", chatId)
    .maybeSingle();
  return data as DtChatRow | null;
}

export type DtChatListScope = "mine" | "team" | "all" | "org";

/** List filter: chat modes plus SEO workspace (advisor + personal twin chats). */
export type DtChatListMode = DtChatMode | "seo_workspace";

const DT_CHAT_LIST_SELECT =
  "id,organisation_id,agent_id,mode,owner_user_id,title,archived_at,pinned,shared_to_team_at,created_at,updated_at";

/** PostgREST `.or()` filter: team chats + personal chats shared with the org. */
export function dtChatTeamOrFilter(tablePrefix?: string): string {
  const p = tablePrefix ? `${tablePrefix}.` : "";
  return `${p}mode.eq.team,${p}shared_to_team_at.not.is.null`;
}

/** PostgREST `.or()` filter: own personal chats + team/shared org chats. */
export function dtChatVisibleOrFilter(userId: string, tablePrefix?: string): string {
  const p = tablePrefix ? `${tablePrefix}.` : "";
  return [
    `and(${p}mode.eq.default,${p}owner_user_id.eq.${userId},${p}legacy_session_id.is.null)`,
    `${p}mode.eq.team`,
    `and(${p}mode.eq.default,${p}shared_to_team_at.not.is.null)`,
  ].join(",");
}

/**
 * SEO workspace sidebar: SEO advisor chats + the user's own persona/twin chats.
 * Twins are selectable in the SEO UI but created as mode=default.
 */
export function dtChatSeoWorkspaceOrFilter(userId: string, tablePrefix?: string): string {
  const p = tablePrefix ? `${tablePrefix}.` : "";
  return [
    `${p}mode.eq.seo`,
    `and(${p}mode.eq.default,${p}owner_user_id.eq.${userId},${p}legacy_session_id.is.null)`,
  ].join(",");
}

export async function listDtChats(params: {
  organisationId: string;
  scope: DtChatListScope;
  userId: string;
  includeArchived?: boolean;
  chatMode?: DtChatListMode;
  /** Platform-admin oversight: list any org member's chats. */
  adminOversight?: boolean;
  /** Filter chats by owner (personal chats of that user). */
  ownerUserId?: string;
}): Promise<DtChatRow[]> {
  const supabase = await createClient();
  const modeFilter = params.chatMode ?? "default";
  let q = supabase
    .from("dt_chats")
    .select(DT_CHAT_LIST_SELECT)
    .eq("organisation_id", params.organisationId)
    .order("updated_at", { ascending: false });

  // SEO workspace: advisor chats + personal twin chats (selectable in that UI).
  if (modeFilter === "seo_workspace") {
    if (params.adminOversight && params.scope === "org") {
      q = q.in("mode", ["seo", "default"]);
      if (params.ownerUserId) q = q.eq("owner_user_id", params.ownerUserId);
    } else {
      q = q.or(dtChatSeoWorkspaceOrFilter(params.userId));
    }
  } else if (modeFilter === "seo") {
    // SEO-only list (owner is typically null).
    q = q.eq("mode", "seo");
    if (params.adminOversight && params.scope === "org" && params.ownerUserId) {
      q = q.eq("owner_user_id", params.ownerUserId);
    }
  } else if (params.adminOversight && params.scope === "org") {
    // Oversight: every chat in the org, optionally filtered to one person.
    if (params.ownerUserId) {
      q = q.eq("owner_user_id", params.ownerUserId);
    }
  } else if (params.scope === "mine") {
    // Personal chats only: created by this user in-app (exclude legacy migration rows).
    q = q
      .eq("mode", "default")
      .eq("owner_user_id", params.userId)
      .is("legacy_session_id", null);
  } else if (params.scope === "team") {
    q = q.or(dtChatTeamOrFilter());
  } else if (params.scope === "all") {
    q = q.or(dtChatVisibleOrFilter(params.userId));
  } else {
    q = q.or(dtChatVisibleOrFilter(params.userId));
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
      prompt_append: string | null;
      is_default: boolean;
      uses_global_prompt: boolean;
    }
  >
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("dt_agents")
    .select(
      "id,organisation_id,template_id,slug,name,role,kind,quick_actions,is_enabled,position,prompt_template,prompt_append,is_default,uses_global_prompt",
    )
    .eq("organisation_id", organisationId)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as Array<
    DtAgentRow & {
      template_id: string | null;
      prompt_template: string;
      prompt_append: string | null;
      is_default: boolean;
      uses_global_prompt: boolean;
    }
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

export async function shareDtChatToTeam(
  chatId: string,
): Promise<{ chat: DtChatRow | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dt_share_chat_to_team", {
    p_chat_id: chatId,
  });
  if (error) return { chat: null, error: error.message };
  return { chat: (data as DtChatRow | null) ?? null, error: null };
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
