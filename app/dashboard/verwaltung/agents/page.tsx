import { redirect } from "next/navigation";

import { DtAgentsManager } from "@/components/dt/agents/dt-agents-manager";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { loadDtUserOrganisations } from "@/lib/dt/load-user-organisations";
import { createClient } from "@/lib/supabase/server";

export default async function VerwaltungAgentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const platformAdmin = await isPlatformAdmin(supabase, user.id);
  const { organisations } = await loadDtUserOrganisations(user.id);

  const adminOrgs = organisations
    .filter((o) => o.canManageAgents)
    .map((o) => ({ id: o.id, name: o.name }));

  if (adminOrgs.length === 0 && platformAdmin) {
    const { data: allOrgs } = await supabase
      .from("organisations")
      .select("id,name")
      .order("name", { ascending: true })
      .limit(50);
    for (const o of allOrgs ?? []) adminOrgs.push({ id: o.id, name: o.name });
  }

  if (adminOrgs.length === 0) {
    redirect("/dashboard");
  }

  return (
    <DtAgentsManager organisations={adminOrgs} initialOrgId={adminOrgs[0]!.id} />
  );
}
