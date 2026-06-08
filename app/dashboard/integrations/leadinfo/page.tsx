import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { LeadinfoIntegrationPanel } from "@/app/dashboard/integrations/_components/leadinfo-integration-panel";
import { OrganisationSwitcher } from "@/app/dashboard/_components/organisation-switcher";
import { PersistedOrganisationUrlSync } from "@/components/shared/persisted-organisation-url-sync";
import {
  canManageOrganisation,
  getAuthenticatedUserId,
  loadUserOrganisations,
  resolveSelectedOrganisationId,
} from "@/lib/dashboard/org-context";
import {
  buildLeadinfoWebhookUrl,
  LEADINFO_PROVIDER,
} from "@/lib/integrations/leadinfo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function LeadinfoIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: orgParam } = await searchParams;
  const { supabase, userId } = await getAuthenticatedUserId();
  const { organisations } = await loadUserOrganisations(userId);
  const selectedOrganisationId = resolveSelectedOrganisationId(organisations, orgParam);

  if (!selectedOrganisationId) {
    redirect("/dashboard/integrations");
  }

  const canManage = await canManageOrganisation(
    supabase,
    userId,
    selectedOrganisationId,
  );

  if (!canManage) {
    redirect("/dashboard");
  }

  const selectedOrgName =
    organisations.find((org) => org.id === selectedOrganisationId)?.name ?? "Organisation";

  const { data: integration } = await supabase
    .from("org_integrations")
    .select("webhook_token, status")
    .eq("organisation_id", selectedOrganisationId)
    .eq("provider", LEADINFO_PROVIDER)
    .maybeSingle();

  const webhookUrl = integration?.webhook_token
    ? buildLeadinfoWebhookUrl(integration.webhook_token)
    : null;
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
          <h1 className="text-2xl font-bold tracking-tight text-primary">Leadinfo</h1>
          <p className="text-secondary">
            Webhook settings for <span className="text-primary">{selectedOrgName}</span>.
          </p>
        </div>
        <OrganisationSwitcher
          organisations={organisations.map(({ id, name }) => ({ id, name }))}
          selectedOrganisationId={selectedOrganisationId}
          orgPath="/dashboard/integrations/leadinfo"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/integrations${orgQuery}`}>All integrations</Link>
        </Button>
        {integration ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/integrations/leadinfo/events${orgQuery}`}>
              Received events
            </Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Webhook URL</CardTitle>
          <CardDescription>
            Paste this URL into Leadinfo to start receiving visitor payloads.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadinfoIntegrationPanel
            organisationId={selectedOrganisationId}
            webhookUrl={webhookUrl}
            status={integration?.status ?? null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
