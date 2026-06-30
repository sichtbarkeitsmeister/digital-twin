import type { DtUserOrganisation } from "@/lib/dt/load-user-organisations";
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

  if (!platformAdmin) {
    return { organisations: [], isPlatformAdmin: false, canAccessSeo: false };
  }

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
