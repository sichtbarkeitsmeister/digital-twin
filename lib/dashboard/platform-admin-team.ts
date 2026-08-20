import type { SupabaseClient } from "@supabase/supabase-js";

export type PlatformTeamMember = {
  id: string;
  email: string;
  role: string;
};

export function sortPlatformTeamMembers(
  rows: PlatformTeamMember[],
): PlatformTeamMember[] {
  return [...rows].sort((a, b) => {
    if (a.role === b.role) return a.email.localeCompare(b.email, "de");
    if (a.role === "admin") return -1;
    if (b.role === "admin") return 1;
    return a.email.localeCompare(b.email, "de");
  });
}

export async function loadPlatformAdminTeam(
  supabase: SupabaseClient,
): Promise<PlatformTeamMember[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id,email,role")
    .order("role", { ascending: true })
    .order("email", { ascending: true });

  return sortPlatformTeamMembers(
    (data ?? []).map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
    })),
  );
}
