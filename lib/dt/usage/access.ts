import type { SupabaseClient } from "@supabase/supabase-js";

import { isPlatformAdmin } from "@/lib/dt/org-access";

export async function canViewDtUsage(
  supabase: SupabaseClient,
  userId: string,
  organisationId: string,
): Promise<boolean> {
  if (await isPlatformAdmin(supabase, userId)) return true;

  const { data } = await supabase.rpc("my_org_role", { org_id: organisationId });
  const role = typeof data === "string" ? data : null;
  return role === "owner" || role === "admin";
}

export async function userCanViewAnyDtUsage(userId: string): Promise<boolean> {
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
