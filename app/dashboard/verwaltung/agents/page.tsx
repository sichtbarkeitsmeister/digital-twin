import { redirect } from "next/navigation";

import { DtAgentsManager } from "@/components/dt/agents/dt-agents-manager";
import { loadDtManageOrganisations } from "@/lib/dt/load-manage-organisations";
import { createClient } from "@/lib/supabase/server";

export default async function VerwaltungAgentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { organisations: adminOrgs } = await loadDtManageOrganisations(user.id);

  if (adminOrgs.length === 0) {
    redirect("/dashboard");
  }

  return (
    <DtAgentsManager organisations={adminOrgs} initialOrgId={adminOrgs[0]!.id} />
  );
}
