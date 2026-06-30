import type { SupabaseClient } from "@supabase/supabase-js";

export type DtAgentEditRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export type DtAgentProposedChanges = {
  name?: string;
  role?: string | null;
  prompt_template?: string;
  quick_actions?: string[];
  is_enabled?: boolean;
  position?: number;
};

export type DtAgentEditRequestRow = {
  id: string;
  organisation_id: string;
  agent_id: string;
  requested_by_user_id: string;
  status: DtAgentEditRequestStatus;
  proposed_changes: DtAgentProposedChanges;
  request_note: string | null;
  reviewer_note: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DtAgentEditRequestView = DtAgentEditRequestRow & {
  organisation_name?: string;
  agent_name?: string;
  agent_slug?: string;
  requester_email?: string | null;
};

const REQUEST_SELECT =
  "id,organisation_id,agent_id,requested_by_user_id,status,proposed_changes,request_note,reviewer_note,reviewed_by_user_id,reviewed_at,created_at,updated_at";

export function buildAgentProposedChanges(params: {
  current: {
    name: string;
    role: string | null;
    prompt_template: string;
    quick_actions: string[];
    is_enabled: boolean;
    position: number;
  };
  next: {
    name: string;
    role: string | null;
    prompt_template: string;
    quick_actions: string[];
    is_enabled: boolean;
    position: number;
  };
}): DtAgentProposedChanges | null {
  const patch: DtAgentProposedChanges = {};
  const { current, next } = params;

  if (next.name !== current.name) patch.name = next.name;
  if (next.role !== current.role) patch.role = next.role;
  if (next.prompt_template !== current.prompt_template) patch.prompt_template = next.prompt_template;
  if (next.is_enabled !== current.is_enabled) patch.is_enabled = next.is_enabled;
  if (next.position !== current.position) patch.position = next.position;

  const currentQuick = JSON.stringify(current.quick_actions);
  const nextQuick = JSON.stringify(next.quick_actions);
  if (currentQuick !== nextQuick) patch.quick_actions = next.quick_actions;

  return Object.keys(patch).length > 0 ? patch : null;
}

export async function listDtAgentEditRequestsForOrg(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<DtAgentEditRequestRow[]> {
  const { data } = await supabase
    .from("dt_agent_edit_requests")
    .select(REQUEST_SELECT)
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false })
    .limit(50);

  return (data ?? []) as DtAgentEditRequestRow[];
}

export async function listPendingDtAgentEditRequests(
  supabase: SupabaseClient,
): Promise<DtAgentEditRequestView[]> {
  const { data } = await supabase
    .from("dt_agent_edit_requests")
    .select(
      `${REQUEST_SELECT}, organisations(name), dt_agents(name, slug)`,
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => {
    const org = Array.isArray(row.organisations) ? row.organisations[0] : row.organisations;
    const agent = Array.isArray(row.dt_agents) ? row.dt_agents[0] : row.dt_agents;
    const { organisations: _o, dt_agents: _a, ...base } = row;
    return {
      ...(base as DtAgentEditRequestRow),
      organisation_name: org?.name,
      agent_name: agent?.name,
      agent_slug: agent?.slug,
    };
  });
}

export async function countPendingDtAgentEditRequests(
  supabase: SupabaseClient,
): Promise<number> {
  const { count } = await supabase
    .from("dt_agent_edit_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

export async function createDtAgentEditRequest(params: {
  supabase: SupabaseClient;
  organisationId: string;
  agentId: string;
  userId: string;
  proposedChanges: DtAgentProposedChanges;
  requestNote?: string | null;
}): Promise<{ request: DtAgentEditRequestRow | null; error: string | null }> {
  const { data, error } = await params.supabase
    .from("dt_agent_edit_requests")
    .insert({
      organisation_id: params.organisationId,
      agent_id: params.agentId,
      requested_by_user_id: params.userId,
      proposed_changes: params.proposedChanges,
      request_note: params.requestNote?.trim() || null,
    })
    .select(REQUEST_SELECT)
    .single();

  if (error) {
    if (error.code === "23505") {
      return { request: null, error: "Für diesen Agenten liegt bereits eine offene Anfrage vor." };
    }
    return { request: null, error: error.message };
  }

  return { request: data as DtAgentEditRequestRow, error: null };
}

export async function cancelDtAgentEditRequest(params: {
  supabase: SupabaseClient;
  requestId: string;
  userId: string;
}): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await params.supabase
    .from("dt_agent_edit_requests")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", params.requestId)
    .eq("requested_by_user_id", params.userId)
    .eq("status", "pending");

  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}

export async function reviewDtAgentEditRequest(params: {
  supabase: SupabaseClient;
  requestId: string;
  decision: "approve" | "reject";
  reviewerNote?: string | null;
}): Promise<{ request: DtAgentEditRequestRow | null; error: string | null }> {
  const { data, error } = await params.supabase.rpc("dt_review_agent_edit_request", {
    p_request_id: params.requestId,
    p_decision: params.decision,
    p_reviewer_note: params.reviewerNote?.trim() || null,
  });

  if (error) {
    const code = error.message;
    if (code.includes("request_not_found")) {
      return { request: null, error: "Anfrage nicht gefunden." };
    }
    if (code.includes("request_not_pending")) {
      return { request: null, error: "Diese Anfrage wurde bereits bearbeitet." };
    }
    if (code.includes("forbidden")) {
      return { request: null, error: "Keine Berechtigung." };
    }
    return { request: null, error: error.message };
  }

  return { request: data as DtAgentEditRequestRow, error: null };
}

export function formatAgentEditRequestStatus(status: DtAgentEditRequestStatus): string {
  switch (status) {
    case "pending":
      return "In Prüfung";
    case "approved":
      return "Übernommen";
    case "rejected":
      return "Abgelehnt";
    case "cancelled":
      return "Zurückgezogen";
    default:
      return status;
  }
}
