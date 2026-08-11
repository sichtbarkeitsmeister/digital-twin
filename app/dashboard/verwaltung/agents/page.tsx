import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DtAgentsManager } from "@/components/dt/agents/dt-agents-manager";
import { filterAgentsHiddenFromOrgMembers } from "@/lib/dt/agents/seo-advisor";
import { loadAgentsForOrgManage } from "@/lib/dt/db";
import { canDirectlyEditDtAgents } from "@/lib/dt/org-access";
import { loadDtManageOrganisations } from "@/lib/dt/load-manage-organisations";
import { createClient } from "@/lib/supabase/server";

async function AgentsPageContent({
  searchParams,
}: {
  searchParams: { org?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const [{ organisations: adminOrgs }, initialCanDirectlyEdit] = await Promise.all([
    loadDtManageOrganisations(user.id),
    canDirectlyEditDtAgents(supabase, user.id),
  ]);

  if (adminOrgs.length === 0) {
    redirect("/dashboard");
  }

  const initialOrgId =
    searchParams.org && adminOrgs.some((organisation) => organisation.id === searchParams.org)
      ? searchParams.org
      : adminOrgs[0]!.id;

  const rawAgents = await loadAgentsForOrgManage(initialOrgId, supabase);
  const initialAgents = initialCanDirectlyEdit
    ? rawAgents
    : filterAgentsHiddenFromOrgMembers(rawAgents);

  return (
    <DtAgentsManager
      organisations={adminOrgs}
      initialOrgId={initialOrgId}
      initialCanDirectlyEdit={initialCanDirectlyEdit}
      initialAgents={initialAgents}
    />
  );
}

export default async function VerwaltungAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;

  return (
    <Suspense
      fallback={
        <p className="text-sm text-sbkm-ink-600 dark:text-white/70">Agenten werden geladen …</p>
      }
    >
      <AgentsPageContent searchParams={sp} />
    </Suspense>
  );
}
