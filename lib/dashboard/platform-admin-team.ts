import type { SupabaseClient } from "@supabase/supabase-js";

export type PlatformTeamMember = {
  id: string;
  email: string;
  role: string;
};

export function sortPlatformTeamMembers(
  rows: PlatformTeamMember[],
): PlatformTeamMember[] {
  return [...rows].sort((a, b) => a.email.localeCompare(b.email, "de"));
}

export async function loadPlatformAdminTeam(
  supabase: SupabaseClient,
): Promise<PlatformTeamMember[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id,email,role")
    .eq("role", "admin")
    .order("email", { ascending: true });

  return sortPlatformTeamMembers(
    (data ?? []).map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
    })),
  );
}
