import { loadDtUserOrganisations } from "@/lib/dt/load-user-organisations";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { createClient } from "@/lib/supabase/server";
import { organisationOptionLabel } from "@/lib/shared/organisation-option";

export type DtManageOrganisation = {
  id: string;
  name: string;
  slug: string | null;
  displayName: string | null;
};

async function withDisplayNames(
  orgs: Array<{ id: string; name: string; slug?: string | null }>,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<DtManageOrganisation[]> {
  const ids = orgs.map((o) => o.id);
  const displayById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: configs } = await supabase
      .from("dt_org_config")
      .select("organisation_id, display_name")
      .in("organisation_id", ids);
    for (const row of configs ?? []) {
      const label = row.display_name?.trim();
      if (label) displayById.set(row.organisation_id, label);
    }
  }

  return orgs
    .map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug ?? null,
      displayName: displayById.get(o.id) ?? null,
    }))
    .sort((a, b) =>
      organisationOptionLabel(a).localeCompare(organisationOptionLabel(b), "de"),
    );
}

/** Organisations selectable on agent management / context inspector pages. */
export async function loadDtManageOrganisations(userId: string): Promise<{
  organisations: DtManageOrganisation[];
  isPlatformAdmin: boolean;
}> {
  const supabase = await createClient();
  const platformAdmin = await isPlatformAdmin(supabase, userId);

  if (platformAdmin) {
    const { data: allOrgs } = await supabase
      .from("organisations")
      .select("id, name, slug")
      .is("archived_at", null)
      .order("name", { ascending: true });

    return {
      organisations: await withDisplayNames(allOrgs ?? [], supabase),
      isPlatformAdmin: true,
    };
  }

  const { organisations } = await loadDtUserOrganisations(userId);

  const byId = new Map<string, { id: string; name: string; slug: string | null }>();
  for (const o of organisations) {
    if (o.canManageAgents) {
      byId.set(o.id, { id: o.id, name: o.name, slug: o.slug });
    }
  }

  const { data: ownedOrgs } = await supabase
    .from("organisations")
    .select("id, name, slug")
    .eq("owner_user_id", userId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  for (const o of ownedOrgs ?? []) {
    if (!byId.has(o.id)) byId.set(o.id, { id: o.id, name: o.name, slug: o.slug });
  }

  return {
    organisations: await withDisplayNames([...byId.values()], supabase),
    isPlatformAdmin: false,
  };
}
