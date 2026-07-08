import { redirect } from "next/navigation";
import { Suspense } from "react";

import { loadDtManageOrganisations } from "@/lib/dt/load-manage-organisations";
import { loadDtUserOrganisations } from "@/lib/dt/load-user-organisations";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { createClient } from "@/lib/supabase/server";

import { OrganisationEmptyState } from "@/app/dashboard/_components/organisations/organisation-empty-state";
import {
  OrganisationDetailFallback,
  OrganisationDetailView,
} from "@/app/dashboard/_components/organisations/organisation-detail-view";
import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
import { PersistedOrganisationUrlSync } from "@/components/shared/persisted-organisation-url-sync";

export default async function OrganisationsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: orgParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user?.id) {
    redirect("/auth/login");
  }

  const platformAdmin = await isPlatformAdmin(supabase, user.id);

  let allowedIds: string[];
  let defaultOrganisationId: string | null;

  if (platformAdmin) {
    const { organisations: manageOrgs } = await loadDtManageOrganisations(user.id);
    if (manageOrgs.length === 0) {
      return (
        <OrganisationPageShell>
          <OrganisationEmptyState />
        </OrganisationPageShell>
      );
    }
    allowedIds = manageOrgs.map((organisation) => organisation.id);
    defaultOrganisationId = manageOrgs[0]!.id;
  } else {
    const { organisations, error } = await loadDtUserOrganisations(user.id);

    if (error) {
      return (
        <OrganisationPageShell>
          <p className="text-sm text-secondary">
            Organisationen konnten nicht geladen werden.
          </p>
        </OrganisationPageShell>
      );
    }

    if (organisations.length === 0) {
      return (
        <OrganisationPageShell>
          <OrganisationEmptyState />
        </OrganisationPageShell>
      );
    }

    allowedIds = organisations.map((organisation) => organisation.id);
    defaultOrganisationId = organisations[0]!.id;
  }

  const selectedOrganisationId =
    orgParam && allowedIds.includes(orgParam) ? orgParam : defaultOrganisationId!;

  return (
    <>
      <Suspense fallback={null}>
        <PersistedOrganisationUrlSync allowedOrganisationIds={allowedIds} />
      </Suspense>
      <Suspense fallback={<OrganisationDetailFallback />}>
        <OrganisationDetailView organisationId={selectedOrganisationId} />
      </Suspense>
    </>
  );
}
