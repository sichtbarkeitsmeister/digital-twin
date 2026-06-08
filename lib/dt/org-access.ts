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
  return role === "owner" || role === "admin";
}

export async function userCanManageAnyDtAgents(userId: string): Promise<boolean> {
  const supabase = await import("@/lib/supabase/server").then((m) => m.createClient());
  if (await isPlatformAdmin(supabase, userId)) return true;

  const { count } = await supabase
    .from("organisation_members")
    .select("organisation_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("org_role", ["owner", "admin"]);

  return (count ?? 0) > 0;
}
