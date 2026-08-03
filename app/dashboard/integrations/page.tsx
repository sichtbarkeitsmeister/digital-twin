import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { OrganisationSwitcher } from "@/app/dashboard/_components/organisation-switcher";
import { PersistedOrganisationUrlSync } from "@/components/shared/persisted-organisation-url-sync";
import {
  getAuthenticatedUserId,
  loadUserOrganisations,
  resolveSelectedOrganisationId,
} from "@/lib/dashboard/org-context";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { LEADINFO_PROVIDER } from "@/lib/integrations/leadinfo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: orgParam } = await searchParams;
  const { supabase, userId } = await getAuthenticatedUserId();
  const { organisations } = await loadUserOrganisations(userId);
  const selectedOrganisationId = resolveSelectedOrganisationId(organisations, orgParam);

  if (!selectedOrganisationId) {
    return (
      <div className="grid gap-6">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Integrations</h1>
        <Card>
          <CardHeader>
            <CardTitle>No organisations</CardTitle>
            <CardDescription>
              Join an organisation to connect Leadinfo and other providers.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const canManage = await isPlatformAdmin(supabase, userId);

  if (!canManage) {
    redirect("/dashboard");
  }

  const selectedOrgName =
    organisations.find((org) => org.id === selectedOrganisationId)?.name ?? "Organisation";

  const { data: leadinfoIntegration } = await supabase
    .from("org_integrations")
    .select("id, status")
    .eq("organisation_id", selectedOrganisationId)
    .eq("provider", LEADINFO_PROVIDER)
    .maybeSingle();

  const orgQuery = `?org=${selectedOrganisationId}`;

  return (
    <div className="grid gap-6">
      <Suspense fallback={null}>
        <PersistedOrganisationUrlSync
          allowedOrganisationIds={organisations.map((organisation) => organisation.id)}
        />
      </Suspense>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">Integrations</h1>
          <p className="text-secondary">
            Connect data sources for <span className="text-primary">{selectedOrgName}</span>.
          </p>
        </div>
        <OrganisationSwitcher
          organisations={organisations.map(({ id, name }) => ({ id, name }))}
          selectedOrganisationId={selectedOrganisationId}
          orgPath="/dashboard/integrations"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>Leadinfo</CardTitle>
              <CardDescription>
                Receive visitor and company payloads via webhook.
              </CardDescription>
            </div>
            <Badge variant={leadinfoIntegration ? "default" : "secondary"}>
              {leadinfoIntegration ? leadinfoIntegration.status : "Not connected"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/dashboard/integrations/leadinfo${orgQuery}`}>
              {leadinfoIntegration ? "Manage" : "Connect"}
            </Link>
          </Button>
          {leadinfoIntegration ? (
            <Button asChild variant="outline">
              <Link href={`/dashboard/integrations/leadinfo/events${orgQuery}`}>
                View events
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
