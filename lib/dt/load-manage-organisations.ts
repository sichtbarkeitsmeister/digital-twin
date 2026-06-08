import { loadDtUserOrganisations } from "@/lib/dt/load-user-organisations";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { createClient } from "@/lib/supabase/server";

export type DtManageOrganisation = {
  id: string;
  name: string;
};

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
      .select("id, name")
      .order("name", { ascending: true });

    return {
      organisations: (allOrgs ?? []).map((o) => ({ id: o.id, name: o.name })),
      isPlatformAdmin: true,
    };
  }

  const { organisations } = await loadDtUserOrganisations(userId);

  const byId = new Map<string, DtManageOrganisation>();
  for (const o of organisations) {
    if (o.canManageAgents) byId.set(o.id, { id: o.id, name: o.name });
  }

  const { data: ownedOrgs } = await supabase
    .from("organisations")
    .select("id, name")
    .eq("owner_user_id", userId)
    .order("name", { ascending: true });

  for (const o of ownedOrgs ?? []) {
    if (!byId.has(o.id)) byId.set(o.id, { id: o.id, name: o.name });
  }

  return {
    organisations: [...byId.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "de"),
    ),
    isPlatformAdmin: false,
  };
}
