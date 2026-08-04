import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type OrganisationOption = {
  id: string;
  name: string;
  created_at: string;
};

type MembershipRow = {
  organisation_id: string;
  org_role: string;
  organisations?:
    | {
        id: string;
        name: string;
        created_at: string;
      }
    | Array<{
        id: string;
        name: string;
        created_at: string;
      }>
    | null;
};

export async function getAuthenticatedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user?.id) {
    redirect("/auth/login");
  }

  return { supabase, userId: user.id };
}

export async function loadUserOrganisations(userId: string) {
  const supabase = await createClient();
  const { data: membershipsRaw, error } = await supabase
    .from("organisation_members")
    .select("organisation_id, org_role, organisations ( id, name, created_at )")
    .eq("user_id", userId);

  if (error) {
    return { supabase, organisations: [] as OrganisationOption[], error };
  }

  const memberships = (membershipsRaw ?? []) as unknown as MembershipRow[];
  const organisations = memberships
    .map((membership) => {
      const org = Array.isArray(membership.organisations)
        ? membership.organisations[0] ?? null
        : membership.organisations ?? null;
      return org
        ? { id: org.id, name: org.name, created_at: org.created_at }
        : null;
    })
    .filter((org): org is OrganisationOption => Boolean(org))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return { supabase, organisations, error: null };
}

export function resolveSelectedOrganisationId(
  organisations: OrganisationOption[],
  orgParam: string | undefined,
) {
  const defaultOrgId = organisations[0]?.id ?? null;
  if (orgParam && organisations.some((org) => org.id === orgParam)) {
    return orgParam;
  }
  return defaultOrgId;
}

export async function canManageOrganisation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  organisationId: string,
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.role === "admin") {
    return true;
  }

  const { data: membership } = await supabase
    .from("organisation_members")
    .select("org_role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();

  return membership?.org_role === "owner" || membership?.org_role === "admin";
}

/**
 * Webhook URLs, tokens and raw event payloads are setup plumbing we run for the
 * customer, so the integrations area stays platform-admin only.
 */
export async function userCanManageAnyIntegrations(userId: string) {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  return profile?.role === "admin";
}

/** Hide the Leads nav entry while an organisation has no lead data at all. */
export async function userHasAnyLeads(userId: string) {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.role === "admin") return true;

  const { count } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true });

  return (count ?? 0) > 0;
}

export async function isMemberOfOrganisation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  organisationId: string,
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.role === "admin") return true;

  const { data: membership } = await supabase
    .from("organisation_members")
    .select("org_role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();

  return Boolean(membership);
}
