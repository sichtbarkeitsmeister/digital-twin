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

export async function isOrgOwner(
  supabase: SupabaseClient,
  userId: string,
  organisationId: string,
): Promise<boolean> {
  const { data } = await supabase.rpc("my_org_role", { org_id: organisationId });
  const role = typeof data === "string" ? data : null;
  if (role === "owner") return true;

  const { data: org } = await supabase
    .from("organisations")
    .select("owner_user_id")
    .eq("id", organisationId)
    .maybeSingle();

  return org?.owner_user_id === userId;
}

/** Only platform admins may PATCH/DELETE agents directly. Org owners submit edit requests. */
export async function canDirectlyEditDtAgents(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  return isPlatformAdmin(supabase, userId);
}

/**
 * The context inspector reveals the assembled system prompt, so it stays
 * internal: platform admins only, never customers.
 */
export async function canViewDtAgentContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  return isPlatformAdmin(supabase, userId);
}

export async function userHasAnyOrganisation(userId: string): Promise<boolean> {
  const supabase = await import("@/lib/supabase/server").then((m) => m.createClient());
  if (await isPlatformAdmin(supabase, userId)) return true;

  const { count } = await supabase
    .from("organisation_members")
    .select("organisation_id", { count: "exact", head: true })
    .eq("user_id", userId);

  if ((count ?? 0) > 0) return true;

  const { count: ownedCount } = await supabase
    .from("organisations")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", userId)
    .is("archived_at", null);

  return (ownedCount ?? 0) > 0;
}

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
