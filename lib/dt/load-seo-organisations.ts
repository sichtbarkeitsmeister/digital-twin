import { loadDtUserOrganisations, type DtUserOrganisation } from "@/lib/dt/load-user-organisations";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/dt/org-access";

export type DtSeoOrganisation = DtUserOrganisation & { seoEnabled: boolean };

export async function loadDtSeoOrganisations(userId: string): Promise<{
  organisations: DtSeoOrganisation[];
  isPlatformAdmin: boolean;
  canAccessSeo: boolean;
}> {
  const supabase = await createClient();
  const platformAdmin = await isPlatformAdmin(supabase, userId);

  if (platformAdmin) {
    const { data: rows } = await supabase
      .from("dt_org_config")
      .select("organisation_id,seo_enabled,disabled,organisations(id,name,slug)")
      .order("display_name", { ascending: true });

    const organisations: DtSeoOrganisation[] = [];
    for (const row of rows ?? []) {
      const org = row.organisations as
        | { id: string; name: string; slug: string | null }
        | Array<{ id: string; name: string; slug: string | null }>
        | null;
      const o = Array.isArray(org) ? org[0] : org;
      if (!o) continue;
      organisations.push({
        id: o.id,
        name: o.name,
        slug: o.slug,
        orgRole: "admin",
        canManageAgents: true,
        seoEnabled: Boolean(row.seo_enabled) && !row.disabled,
      });
    }

    return {
      organisations,
      isPlatformAdmin: true,
      canAccessSeo: true,
    };
  }

  const { organisations: memberships } = await loadDtUserOrganisations(userId);
  const adminMemberships = memberships.filter((o) => o.canManageAgents);

  if (adminMemberships.length === 0) {
    return { organisations: [], isPlatformAdmin: false, canAccessSeo: false };
  }

  const ids = adminMemberships.map((o) => o.id);
  const { data: configs } = await supabase
    .from("dt_org_config")
    .select("organisation_id,seo_enabled,disabled")
    .in("organisation_id", ids);

  const cfgMap = new Map((configs ?? []).map((c) => [c.organisation_id, c]));

  const organisations = adminMemberships
    .map((o) => {
      const cfg = cfgMap.get(o.id);
      return {
        ...o,
        seoEnabled: Boolean(cfg?.seo_enabled) && !cfg?.disabled,
      };
    })
    .filter((o) => o.seoEnabled);

  return {
    organisations,
    isPlatformAdmin: false,
    canAccessSeo: organisations.length > 0,
  };
}
