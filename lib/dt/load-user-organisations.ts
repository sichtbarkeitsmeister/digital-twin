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
    | { id: string; name: string; slug: string | null; owner_user_id?: string | null }
    | Array<{ id: string; name: string; slug: string | null; owner_user_id?: string | null }>
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
    .select(
      "organisation_id, org_role, organisations ( id, name, slug, owner_user_id )",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    return { organisations: [], error: error.message };
  }

  const memberships = (membershipsRaw ?? []) as unknown as MembershipRow[];
  const byId = new Map<string, DtUserOrganisation>();

  for (const row of memberships) {
    const org = Array.isArray(row.organisations)
      ? (row.organisations[0] ?? null)
      : (row.organisations ?? null);
    if (!org) continue;
    const orgRole = row.org_role;
    byId.set(org.id, {
      id: org.id,
      name: org.name,
      slug: org.slug,
      orgRole,
      canManageAgents:
        orgRole === "owner" ||
        orgRole === "admin" ||
        org.owner_user_id === userId,
    });
  }

  const { data: ownedOrgs } = await supabase
    .from("organisations")
    .select("id, name, slug, owner_user_id")
    .eq("owner_user_id", userId)
    .order("name", { ascending: true });

  for (const org of ownedOrgs ?? []) {
    if (byId.has(org.id)) continue;
    byId.set(org.id, {
      id: org.id,
      name: org.name,
      slug: org.slug,
      orgRole: "owner",
      canManageAgents: true,
    });
  }

  return { organisations: [...byId.values()], error: null };
}
