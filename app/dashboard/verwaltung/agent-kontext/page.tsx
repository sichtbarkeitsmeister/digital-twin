import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DtAgentContextInspector } from "@/components/dt/agents/dt-agent-context-inspector";
import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
import { loadDtManageOrganisations } from "@/lib/dt/load-manage-organisations";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import type { DtAgentContextMode } from "@/lib/dt/agent-context-inspector";
import { createClient } from "@/lib/supabase/server";

function InspectorFallback() {
  return (
    <OrganisationPageShell>
      <div className="grid gap-3">
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-muted/50" />
        <div className="grid gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/40" />
          ))}
        </div>
      </div>
    </OrganisationPageShell>
  );
}

async function AgentKontextPageContent({
  searchParams,
}: {
  searchParams: { org?: string; agent?: string; mode?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const platformAdmin = await isPlatformAdmin(supabase, user.id);
  if (!platformAdmin) redirect("/dashboard");

  const { organisations: adminOrgs } = await loadDtManageOrganisations(user.id);

  if (adminOrgs.length === 0) {
    redirect("/dashboard");
  }

  const initialOrgId =
    searchParams.org && adminOrgs.some((o) => o.id === searchParams.org)
      ? searchParams.org
      : adminOrgs[0]!.id;

  const initialMode: DtAgentContextMode =
    searchParams.mode === "seo" || searchParams.mode === "team"
      ? searchParams.mode
      : "default";

  return (
    <OrganisationPageShell>
      <Suspense fallback={<InspectorFallback />}>
        <DtAgentContextInspector
          organisations={adminOrgs}
          initialOrgId={initialOrgId}
          initialAgentId={searchParams.agent ?? null}
          initialMode={initialMode}
          isPlatformAdmin={platformAdmin}
        />
      </Suspense>
    </OrganisationPageShell>
  );
}

export default async function AgentKontextPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; agent?: string; mode?: string }>;
}) {
  const sp = await searchParams;
  return (
    <Suspense fallback={<InspectorFallback />}>
      <AgentKontextPageContent searchParams={sp} />
    </Suspense>
  );
}
