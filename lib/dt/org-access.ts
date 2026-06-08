import type { SupabaseClient } from "@supabase/supabase-js";

export async function isPlatformAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin";
}

export async function canManageDtAgents(
  supabase: SupabaseClient,
  userId: string,
  organisationId: string,
): Promise<boolean> {
  if (await isPlatformAdmin(supabase, userId)) return true;

  const { data } = await supabase.rpc("my_org_role", { org_id: organisationId });
  const role = typeof data === "string" ? data : null;
  if (role === "owner" || role === "admin") return true;

  const { data: org } = await supabase
    .from("organisations")
    .select("owner_user_id")
    .eq("id", organisationId)
    .maybeSingle();

  return org?.owner_user_id === userId;
}

/** Same access as agent management — owners/admins/platform admins per org. */
export const canViewDtAgentContext = canManageDtAgents;

export async function userCanManageAnyDtAgents(userId: string): Promise<boolean> {
  const supabase = await import("@/lib/supabase/server").then((m) => m.createClient());
  if (await isPlatformAdmin(supabase, userId)) return true;

  const { count } = await supabase
    .from("organisation_members")
    .select("organisation_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("org_role", ["owner", "admin"]);

  if ((count ?? 0) > 0) return true;

  const { count: ownedCount } = await supabase
    .from("organisations")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", userId);

  return (ownedCount ?? 0) > 0;
}
