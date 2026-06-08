import { createClient } from "@/lib/supabase/server";

export type DtUserOrganisation = {
  id: string;
  name: string;
  slug: string | null;
  orgRole: string;
  canManageAgents: boolean;
};

type MembershipRow = {
  organisation_id: string;
  org_role: string;
  organisations?:
    | { id: string; name: string; slug: string | null }
    | Array<{ id: string; name: string; slug: string | null }>
    | null;
};

/** Loads organisations for the current user (for DigitalTwin chat shell). */
export async function loadDtUserOrganisations(userId: string): Promise<{
  organisations: DtUserOrganisation[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data: membershipsRaw, error } = await supabase
    .from("organisation_members")
    .select("organisation_id, org_role, organisations ( id, name, slug )")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    return { organisations: [], error: error.message };
  }

  const memberships = (membershipsRaw ?? []) as unknown as MembershipRow[];
  const organisations = memberships
    .map((row) => {
      const org = Array.isArray(row.organisations)
        ? (row.organisations[0] ?? null)
        : (row.organisations ?? null);
      if (!org) return null;
      const orgRole = row.org_role;
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        orgRole,
        canManageAgents: orgRole === "owner" || orgRole === "admin",
      };
    })
    .filter((o): o is DtUserOrganisation => Boolean(o));

  return { organisations, error: null };
}
